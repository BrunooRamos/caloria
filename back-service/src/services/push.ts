import { z } from "zod";

// API de Expo Push: https://docs.expo.dev/push-notifications/sending-notifications/
export const EXPO_SEND_URL = "https://exp.host/--/api/v2/push/send";
export const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
// Topes de Expo por request: más que eso es un 400 de toda la request.
export const EXPO_MAX_MESSAGES = 100;
export const EXPO_MAX_RECEIPT_IDS = 1_000;
// Tope de cada request. Sin reintentos acá: el aviso no se reintenta y los receipts los reintenta BullMQ.
export const PUSH_TIMEOUT_MS = 10_000;
// El token ya no sirve: hay que dejar de mandarle.
export const DEVICE_NOT_REGISTERED = "DeviceNotRegistered";

export interface PushMessage {
  title: string;
  body: string;
  /** Lo que la app necesita para abrir la pantalla correcta. */
  data: Record<string, string>;
}

/** Un ticket aceptado: su receipt se consulta más tarde. `device` es el token. */
export interface PushReceiptRef {
  id: string;
  device: string;
}

export interface PushSendResult {
  ok: number;
  failed: number;
  /** Tokens que Expo ya marcó como inválidos en el ticket. */
  invalid: string[];
  /** Tickets aceptados, para consultar sus receipts. */
  receipts: PushReceiptRef[];
}

export interface PushReceiptsResult {
  ok: number;
  failed: number;
  /** Receipts que Expo todavía no tiene. */
  pending: number;
  /** Tokens que el receipt marcó como inválidos. */
  invalid: string[];
}

export interface PushService {
  /** Manda el mensaje a cada token. Lanza si falla la request entera (red, 4xx, 5xx). */
  send(tokens: string[], message: PushMessage): Promise<PushSendResult>;
  /** Consulta los receipts. Lanza si falla la request entera. */
  checkReceipts(receipts: PushReceiptRef[]): Promise<PushReceiptsResult>;
}

/** La request entera falló. `codes` son los `errors[].code` de Expo (p. ej. TOO_MANY_REQUESTS). */
export class PushRequestError extends Error {
  constructor(
    readonly status: number,
    readonly codes: string[],
  ) {
    super(`Expo Push respondió ${status}${codes.length ? ` (${codes.join(", ")})` : ""}`);
    this.name = "PushRequestError";
  }
}

const resultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("ok"), id: z.string().optional() }),
  z.object({
    status: z.literal("error"),
    details: z.object({ error: z.string().optional() }).loose().optional(),
  }),
]);
type ExpoResult = z.infer<typeof resultSchema>;

const sendResponseSchema = z.object({ data: z.array(resultSchema) });
const receiptsResponseSchema = z.object({ data: z.record(z.string(), resultSchema) });
const errorsSchema = z.object({ errors: z.array(z.object({ code: z.string() })) });

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

const isNotRegistered = (result: ExpoResult) =>
  result.status === "error" && result.details?.error === DEVICE_NOT_REGISTERED;

export interface ExpoPushOptions {
  /** Solo hace falta si el proyecto tiene activada la seguridad de push en EAS. */
  accessToken?: string;
  timeoutMs?: number;
  /** Solo para tests: reemplaza el fetch global. */
  fetch?: typeof globalThis.fetch;
}

export function createExpoPush({
  accessToken,
  timeoutMs = PUSH_TIMEOUT_MS,
  fetch = globalThis.fetch,
}: ExpoPushOptions = {}): PushService {
  async function post(url: string, body: unknown): Promise<unknown> {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...(accessToken && { authorization: `Bearer ${accessToken}` }),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json: unknown = await res.json().catch(() => undefined);
    const errors = errorsSchema.safeParse(json);
    if (!res.ok || errors.success) {
      throw new PushRequestError(res.status, errors.data?.errors.map((e) => e.code) ?? []);
    }
    return json;
  }

  return {
    async send(tokens, { title, body, data }) {
      const result: PushSendResult = { ok: 0, failed: 0, invalid: [], receipts: [] };
      // Un mensaje por token: los tickets vuelven en el mismo orden.
      for (const devices of chunk(tokens, EXPO_MAX_MESSAGES)) {
        const messages = devices.map((to) => ({ to, title, body, data, sound: "default" }));
        const { data: tickets } = sendResponseSchema.parse(await post(EXPO_SEND_URL, messages));
        if (tickets.length !== devices.length) {
          throw new Error(
            `Expo devolvió ${tickets.length} tickets para ${devices.length} mensajes`,
          );
        }
        tickets.forEach((ticket, i) => {
          if (ticket.status === "ok") {
            result.ok++;
            if (ticket.id) result.receipts.push({ id: ticket.id, device: devices[i] });
          } else {
            result.failed++;
            if (isNotRegistered(ticket)) result.invalid.push(devices[i]);
          }
        });
      }
      return result;
    },

    async checkReceipts(receipts) {
      const result: PushReceiptsResult = { ok: 0, failed: 0, pending: 0, invalid: [] };
      for (const refs of chunk(receipts, EXPO_MAX_RECEIPT_IDS)) {
        const ids = refs.map((ref) => ref.id);
        const { data } = receiptsResponseSchema.parse(await post(EXPO_RECEIPTS_URL, { ids }));
        for (const { id, device } of refs) {
          const receipt = Object.hasOwn(data, id) ? data[id] : undefined;
          if (!receipt) result.pending++;
          else if (receipt.status === "ok") result.ok++;
          else {
            result.failed++;
            if (isNotRegistered(receipt)) result.invalid.push(device);
          }
        }
      }
      return result;
    },
  };
}
