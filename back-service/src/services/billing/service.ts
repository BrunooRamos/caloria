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
      try {
        await BillingEventModel.create({
          _id: event.id,
          type: event.type,
          status: "processing",
          receivedAt: now(),
        });
      } catch (err) {
        if ((err as { code?: number }).code !== DUPLICATE_KEY) throw err;
        log.info("webhook de pagos repetido, se ignora", { requestId, eventId: event.id });
        return { duplicate: true };
      }

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
        await BillingEventModel.updateOne({ _id: event.id }, { $set: { status: "done" } });
      } catch (err) {
        // Se libera el id: el proveedor reintenta la entrega y se vuelve a procesar.
        await BillingEventModel.deleteOne({ _id: event.id, status: "processing" });
        throw err;
      }
      log.info("webhook de pagos procesado", { requestId, eventId: event.id, type: event.type });
      return { duplicate: false };
    },
  };
}
