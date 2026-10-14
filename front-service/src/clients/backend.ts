import { AppError, isErrorEnvelope, REQUEST_ID_HEADER } from "@caloria/shared";
import type { ErrorEnvelope } from "@caloria/shared";

export class BackendErrorResponse extends Error {
  constructor(
    readonly status: number,
    readonly body: ErrorEnvelope,
  ) {
    super(`Backend respondió ${status} ${body.error.code}`);
    this.name = "BackendErrorResponse";
  }
}

export interface BackendRequest {
  method: string;
  path: string;
  requestId: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface BackendResponse<T> {
  status: number;
  body: T;
}

export interface BackendClient {
  request<T = unknown>(req: BackendRequest): Promise<BackendResponse<T>>;
}

export function createBackendClient({
  baseUrl,
  timeoutMs,
}: {
  baseUrl: string;
  timeoutMs: number;
}): BackendClient {
  return {
    async request<T>({ method, path, requestId, body, headers }: BackendRequest) {
      const outgoing = new Headers(headers);
      outgoing.set(REQUEST_ID_HEADER, requestId);
      if (body !== undefined) outgoing.set("content-type", "application/json");

      let res: Response;
      try {
        res = await fetch(new URL(path, baseUrl), {
          method,
          headers: outgoing,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        // Conexión rechazada, DNS o timeout: el Backend no está alcanzable.
        throw new AppError("SERVICE_UNAVAILABLE", undefined, { cause: err });
      }

      const text = await res.text().catch(() => "");
      let parsed: unknown;
      try {
        parsed = text === "" ? undefined : JSON.parse(text);
      } catch {
        parsed = text;
      }

      if (!res.ok) {
        if (isErrorEnvelope(parsed)) throw new BackendErrorResponse(res.status, parsed);
        throw new AppError("INTERNAL_ERROR", undefined, {
          cause: new Error(`Backend respondió ${res.status} sin sobre de error válido`),
        });
      }
      if (typeof parsed === "string") {
        throw new AppError("INTERNAL_ERROR", undefined, {
          cause: new Error(`Backend respondió ${res.status} con un body que no es JSON`),
        });
      }
      return { status: res.status, body: parsed as T };
    },
  };
}
