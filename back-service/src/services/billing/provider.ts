import type { SubscriptionStatus } from "../../models/User";

export interface ProviderSubscription {
  id: string;
  customerId: string;
  status: SubscriptionStatus;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd: boolean;
}

export interface CreateSubscriptionInput {
  userId: string;
  /** Cliente que ya tiene el usuario en el proveedor (de una suscripción anterior). */
  customerId?: string;
}

export interface CreateSubscriptionResult {
  customerId: string;
  /** Página del proveedor donde el usuario carga el medio de pago. */
  checkoutUrl: string;
}

export type ProviderEvent =
  | { id: string; type: string; kind: "subscription"; subscriptionId: string; customerId: string }
  | { id: string; type: string; kind: "ignored" };

export interface BillingProvider {
  readonly name: string;
  /**
   * Arranca el alta: crea el cliente si no existe y una sesión de checkout. La suscripción la crea
   * el proveedor cuando el pago se confirma, y llega por webhook.
   */
  createSubscription(input: CreateSubscriptionInput): Promise<CreateSubscriptionResult>;
  getSubscription(subscriptionId: string): Promise<ProviderSubscription>;
  /** Pide que no se renueve: sigue activa hasta el fin del período. */
  cancelAtPeriodEnd(subscriptionId: string): Promise<ProviderSubscription>;
  /** Deshace cancelAtPeriodEnd sobre la misma suscripción (se vuelve a renovar). */
  resumeSubscription(subscriptionId: string): Promise<ProviderSubscription>;
  /**
   * Borra el cliente al borrar la cuenta: cancela en el momento sus suscripciones, sin
   * esperar al fin del período, y quita los medios de pago guardados. Si ya no existe, no falla.
   */
  deleteCustomer(customerId: string): Promise<void>;
  /**
   * Verifica la firma sobre los bytes crudos del body y devuelve el evento normalizado.
   * Lanza InvalidWebhookSignatureError si falta la firma o no es válida.
   */
  verifyWebhook(
    payload: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): ProviderEvent;
}

/** El proveedor no respondió o rechazó la operación. Va a 503 sin tocar la base. */
export class BillingProviderError extends Error {
  constructor(
    message: string,
    /** Detalle para el log (tipo y código del error del proveedor). Nunca datos de pago. */
    readonly detail: Record<string, unknown> = {},
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "BillingProviderError";
  }
}

export class InvalidWebhookSignatureError extends Error {
  constructor(message = "Firma del webhook inválida") {
    super(message);
    this.name = "InvalidWebhookSignatureError";
  }
}
