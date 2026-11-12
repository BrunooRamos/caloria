import { AppError } from "@caloria/shared";
import type { BillingPlanResponse, Logger, SubscribeResponse } from "@caloria/shared";
import { BillingEventModel } from "../../models/BillingEvent";
import { UserModel } from "../../models/User";
import type { User } from "../../models/User";
import { isPremium } from "../plan";
import type { QuotaService } from "../quota";
import { BillingProviderError, InvalidWebhookSignatureError } from "./provider";
import type { BillingProvider, ProviderSubscription } from "./provider";

export interface BillingContext {
  requestId: string;
  log: Logger;
}

export type WebhookHeaders = Record<string, string | string[] | undefined>;

export interface BillingService {
  getPlan(userId: string): Promise<BillingPlanResponse>;
  subscribe(userId: string, context: BillingContext): Promise<SubscribeResponse>;
  cancel(userId: string, context: BillingContext): Promise<BillingPlanResponse>;
  /**
   * Antes de borrar la cuenta: borra el cliente en el proveedor, que corta la suscripción
   * en el momento. Sin cliente no hace nada. Si el proveedor falla o no está configurado → 503.
   */
  closeCustomer(userId: string, context: BillingContext): Promise<void>;
  /** Devuelve `duplicate: true` si el evento ya se había recibido (no se procesa otra vez). */
  handleWebhook(
    payload: Buffer,
    headers: WebhookHeaders,
    context: BillingContext,
  ): Promise<{ duplicate: boolean }>;
}

export interface BillingServiceDeps {
  /** Sin proveedor (faltan las claves): el plan se puede leer, pero subscribe/cancel/webhook dan 503. */
  provider?: BillingProvider;
  quota: QuotaService;
  now?: () => Date;
}

type BillingUser = Pick<User, "_id" | "plan" | "usage" | "profile">;
const USER_FIELDS = { plan: 1, usage: 1, "profile.timezone": 1 } as const;
const DUPLICATE_KEY = 11000;
/**
 * Cuánto dura la reserva de un evento en processing. Si el proceso se cae a mitad de camino,
 * pasado este tiempo la próxima entrega la retoma. Holgado contra el peor caso de una entrega
 * (dos intentos de 10 s contra Stripe más la base).
 */
export const WEBHOOK_CLAIM_LEASE_MS = 2 * 60 * 1000;

export function createBillingService({
  provider,
  quota,
  now = () => new Date(),
}: BillingServiceDeps): BillingService {
  function view(user: BillingUser, at: Date): BillingPlanResponse {
    const premium = isPremium(user.plan, at);
    const end = premium ? user.plan.currentPeriodEnd : undefined;
    return {
      tier: premium ? "premium" : "free",
      periodEnd: end ? end.toISOString() : null,
      renews: Boolean(end) && !user.plan.cancelAtPeriodEnd,
      analyses: quota.remaining(user, at),
    };
  }

  async function load(userId: string): Promise<BillingUser> {
    const user = await UserModel.findById(userId, USER_FIELDS).lean<BillingUser>();
    if (!user) throw new AppError("UNAUTHORIZED");
    return user;
  }

  function requireProvider(operation: string, { requestId, log }: BillingContext) {
    if (provider) return provider;
    log.warn("billing sin configurar (faltan las claves del proveedor)", { requestId, operation });
    throw new AppError("SERVICE_UNAVAILABLE");
  }

  /** Llama al proveedor; si falla → 503 con el detalle en el log, sin tocar la base. */
  async function callProvider<T>(
    operation: string,
    context: BillingContext,
    userId: string | undefined,
    run: (p: BillingProvider) => Promise<T>,
  ): Promise<T> {
    const p = requireProvider(operation, context);
    try {
      return await run(p);
    } catch (err) {
      if (!(err instanceof BillingProviderError)) throw err;
      context.log.error("el proveedor de pagos no respondió", {
        requestId: context.requestId,
        userId,
        provider: p.name,
        operation,
        detail: err.detail,
      });
      throw new AppError("SERVICE_UNAVAILABLE", undefined, { cause: err });
    }
  }

  /**
   * Pasa el estado de la suscripción del proveedor al usuario. Solo `active` da premium y mueve
   * `currentPeriodEnd`; con un cobro pendiente (`past_due`) el período no avanza, así el usuario
   * vuelve a free al terminar lo que pagó. `canceled` lo deja free.
   */
  async function apply(
    user: BillingUser,
    sub: ProviderSubscription,
    at: Date,
    { requestId, log }: BillingContext,
  ): Promise<BillingUser> {
    const current = user.plan;
    const premiumNow = isPremium(current, at);
    if (current.subscriptionId && current.subscriptionId !== sub.id) {
      // Una suscripción vieja (ya reemplazada) no pisa la vigente. Una nueva activa con la
      // vigente todavía activa es un cobro doble: se loguea para revisarlo a mano.
      if (sub.status !== "active" || premiumNow) {
        const level = sub.status === "active" ? "error" : "warn";
        log[level]("evento de una suscripción que no es la vigente, se ignora", {
          requestId,
          userId: user._id.toString(),
          subscriptionId: sub.id,
          currentSubscriptionId: current.subscriptionId,
          status: sub.status,
        });
        return user;
      }
    }

    const set: Record<string, unknown> = {
      "plan.status": sub.status,
      "plan.customerId": sub.customerId,
      "plan.subscriptionId": sub.id,
      "plan.cancelAtPeriodEnd": sub.cancelAtPeriodEnd,
    };
    if (sub.status === "active") {
      set["plan.tier"] = "premium";
      set["plan.currentPeriodEnd"] = sub.currentPeriodEnd;
      if (!premiumNow) set["plan.since"] = at;
    } else if (sub.status === "canceled") {
      set["plan.tier"] = "free";
      if (premiumNow) set["plan.since"] = at;
    }
    const updated = await UserModel.findOneAndUpdate(
      { _id: user._id },
      { $set: set },
      { new: true, projection: USER_FIELDS },
    ).lean<BillingUser>();
    if (!updated) throw new AppError("UNAUTHORIZED");
    log.info("suscripción actualizada", {
      requestId,
      userId: user._id.toString(),
      subscriptionId: sub.id,
      status: sub.status,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      tier: isPremium(updated.plan, at) ? "premium" : "free",
    });
    return updated;
  }

  async function claim(
    event: { id: string; type: string },
    { requestId, log }: BillingContext,
  ): Promise<Date | undefined> {
    const at = now();
    try {
      await BillingEventModel.create({
        _id: event.id,
        type: event.type,
        status: "processing",
        receivedAt: at,
        claimedAt: at,
      });
      return at;
    } catch (err) {
      if ((err as { code?: number }).code !== DUPLICATE_KEY) throw err;
    }

    const retaken = await BillingEventModel.findOneAndUpdate(
      {
        _id: event.id,
        status: "processing",
        claimedAt: { $lte: new Date(at.getTime() - WEBHOOK_CLAIM_LEASE_MS) },
      },
      { $set: { claimedAt: at } },
    ).lean();
    if (retaken) {
      log.warn("webhook de pagos que quedó a medio procesar, se retoma", {
        requestId,
        eventId: event.id,
        type: event.type,
      });
      return at;
    }

    const existing = await BillingEventModel.findById(event.id, { status: 1 }).lean();
    if (existing?.status === "done") {
      log.info("webhook de pagos repetido, se ignora", { requestId, eventId: event.id });
      return undefined;
    }
    // Lo está procesando otra entrega (o se acaba de liberar por un fallo): que reintente.
    log.info("webhook de pagos en proceso por otra entrega, se pide reintentar", {
      requestId,
      eventId: event.id,
    });
    throw new AppError("SERVICE_UNAVAILABLE", "El evento se está procesando");
  }

  return {
    async getPlan(userId) {
      return view(await load(userId), now());
    },

    async subscribe(userId, context) {
      const user = await load(userId);
      const at = now();
      if (isPremium(user.plan, at)) {
        // Cancelado pero todavía en el período pagado: se reactiva la misma suscripción.
        const subscriptionId = user.plan.subscriptionId;
        if (!user.plan.cancelAtPeriodEnd || !subscriptionId) {
          throw new AppError("SUBSCRIPTION_ACTIVE");
        }
        const sub = await callProvider("resumeSubscription", context, userId, (p) =>
          p.resumeSubscription(subscriptionId),
        );
        const updated = await apply(user, sub, at, context);
        return { action: "reactivated", plan: view(updated, at) };
      }

      const { customerId, checkoutUrl } = await callProvider(
        "createSubscription",
        context,
        userId,
        (p) => p.createSubscription({ userId, customerId: user.plan.customerId }),
      );
      // Solo el id del cliente: el plan pasa a premium cuando el webhook confirma el pago.
      if (customerId !== user.plan.customerId) {
        await UserModel.updateOne({ _id: userId }, { $set: { "plan.customerId": customerId } });
      }
      context.log.info("checkout de suscripción creado", {
        requestId: context.requestId,
        userId,
        provider: provider?.name,
      });
      return { action: "checkout", checkoutUrl, plan: view(user, at) };
    },

    async cancel(userId, context) {
      // Sin proveedor configurado, cancel es 503 siempre (igual que subscribe y webhook), aunque
      // no haya nada que cancelar: así el estado de billing no depende del plan del usuario.
      requireProvider("cancelAtPeriodEnd", context);
      const user = await load(userId);
      const at = now();
      const subscriptionId = user.plan.subscriptionId;
      // Free, ya cancelado o premium sin suscripción en el proveedor: no hay nada que cancelar y
      // se responde el plan como está (cancelar dos veces no es un error).
      if (!isPremium(user.plan, at) || user.plan.cancelAtPeriodEnd || !subscriptionId) {
        return view(user, at);
      }
      const sub = await callProvider("cancelAtPeriodEnd", context, userId, (p) =>
        p.cancelAtPeriodEnd(subscriptionId),
      );
      return view(await apply(user, sub, at, context), at);
    },

    async closeCustomer(userId, context) {
      const user = await UserModel.findById(userId, { "plan.customerId": 1 }).lean<
        Pick<User, "plan">
      >();
      const customerId = user?.plan.customerId;
      if (!customerId) return;
      await callProvider("deleteCustomer", context, userId, (p) => p.deleteCustomer(customerId));
      context.log.info("cliente del proveedor de pagos borrado", {
        requestId: context.requestId,
        userId,
        provider: provider?.name,
      });
    },

    async handleWebhook(payload, headers, context) {
      const { requestId, log } = context;
      const p = requireProvider("webhook", context);
      let event;
      try {
        event = p.verifyWebhook(payload, headers);
      } catch (err) {
        if (!(err instanceof InvalidWebhookSignatureError)) throw err;
        // Sin el body: puede venir de cualquiera.
        log.warn("webhook de pagos con firma inválida, se rechaza", {
          requestId,
          reason: err.message,
        });
        throw new AppError("VALIDATION_ERROR", "Firma del webhook inválida");
      }

      // Se reserva el id antes de procesar: un evento repetido (o dos entregas a la vez) no
      // se procesa dos veces.
      const claimedAt = await claim(event, context);
      if (!claimedAt) return { duplicate: true };

      try {
        if (event.kind === "subscription") {
          const { subscriptionId, customerId } = event;
          const user = await UserModel.findOne(
            { "plan.customerId": customerId },
            USER_FIELDS,
          ).lean<BillingUser>();
          if (!user) {
            log.warn("webhook de pagos de un cliente sin usuario, se ignora", {
              requestId,
              eventId: event.id,
              type: event.type,
            });
          } else {
            // El estado se lee del proveedor: no importa si los eventos llegan desordenados.
            const sub = await callProvider("getSubscription", context, user._id.toString(), (pr) =>
              pr.getSubscription(subscriptionId),
            );
            await apply(user, sub, now(), context);
          }
        }
        await BillingEventModel.updateOne(
          { _id: event.id, claimedAt },
          { $set: { status: "done" } },
        );
      } catch (err) {
        // Se libera el id: el proveedor reintenta la entrega y se vuelve a procesar. Solo si la
        // reserva sigue siendo esta (si venció, otra entrega la pudo haber retomado).
        await BillingEventModel.deleteOne({ _id: event.id, status: "processing", claimedAt });
        throw err;
      }
      log.info("webhook de pagos procesado", { requestId, eventId: event.id, type: event.type });
      return { duplicate: false };
    },
  };
}
