import type { Dispatcher } from "undici-types";
import { AppError, isErrorEnvelope, REQUEST_ID_HEADER } from "@caloria/shared";
import type { ErrorEnvelope } from "@caloria/shared";

export const FORWARDED_RESPONSE_HEADERS = ["content-type", "retry-after", "cache-control"] as const;

export type ForwardedHeaders = Partial<Record<(typeof FORWARDED_RESPONSE_HEADERS)[number], string>>;

export class BackendErrorResponse extends Error {
  constructor(
    readonly status: number,
    readonly body: ErrorEnvelope,
    readonly headers: ForwardedHeaders = {},
  ) {
    super(`Backend respondió ${status} ${body.error.code}`);
    this.name = "BackendErrorResponse";
  }
}

export interface BackendRequest {
  method: string;
  path: string;
  requestId: string;
  query?: Record<string, unknown>;
  body?: unknown;
  /** Multipart: fetch arma el Content-Type con el boundary. Excluyente con `body`. */
  form?: FormData;
  headers?: Record<string, string>;
}

export interface BackendResponse<T> {
  status: number;
  headers: ForwardedHeaders;
  body: T;
}

export interface BackendClient {
  request<T = unknown>(req: BackendRequest): Promise<BackendResponse<T>>;
}

export interface BackendClientOptions {
  baseUrl: string;
  timeoutMs: number;
  dispatcher?: Dispatcher;
}

const NOT_JSON = Symbol("not-json");

function parseJson(text: string): unknown {
  if (text === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return NOT_JSON;
  }
}

function forwardedHeaders(headers: Headers): ForwardedHeaders {
  const out: ForwardedHeaders = {};
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = headers.get(name);
    if (value !== null) out[name] = value;
  }
  return out;
}

function invalidResponse(detail: string): AppError {
  return new AppError("INTERNAL_ERROR", undefined, { cause: new Error(detail) });
}

export function createBackendClient({
  baseUrl,
  timeoutMs,
  dispatcher,
}: BackendClientOptions): BackendClient {
  return {
    async request<T>({ method, path, requestId, query, body, form, headers }: BackendRequest) {
      const url = new URL(path, baseUrl);
      for (const [key, value] of Object.entries(query ?? {})) {
        for (const item of [value].flat()) {
          if (item !== undefined) url.searchParams.append(key, String(item));
        }
      }

      const outgoing = new Headers(headers);
      outgoing.set(REQUEST_ID_HEADER, requestId);
      if (body !== undefined) outgoing.set("content-type", "application/json");

      const init: RequestInit & { dispatcher?: Dispatcher } = {
        method,
        headers: outgoing,
        body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
        dispatcher,
      };

      let res: Response;
      let text: string;
      try {
        res = await fetch(url, init);
        text = await res.text();
      } catch (err) {
        // Conexión rechazada, DNS, timeout o conexión cortada: el Backend no está alcanzable.
        throw new AppError("SERVICE_UNAVAILABLE", undefined, { cause: err });
      }

      const parsed = parseJson(text);
      const forwarded = forwardedHeaders(res.headers);
      if (!res.ok) {
        if (isErrorEnvelope(parsed)) throw new BackendErrorResponse(res.status, parsed, forwarded);
        throw invalidResponse(`Backend respondió ${res.status} sin sobre de error válido`);
      }
      if (parsed === NOT_JSON) {
        throw invalidResponse(`Backend respondió ${res.status} con un body que no es JSON`);
      }
      return { status: res.status, headers: forwarded, body: parsed as T };
    },
  };
}
