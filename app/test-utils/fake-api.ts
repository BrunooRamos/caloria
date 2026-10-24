import type { AuthTokens, TokenStorage } from "@/services/token-storage";

export const BASE_URL = "http://api.test/api/v1";
export const OLD_TOKENS: AuthTokens = { accessToken: "access-old", refreshToken: "refresh-1" };
export const NEW_TOKENS: AuthTokens = { accessToken: "access-new", refreshToken: "refresh-2" };

export interface Call {
  path: string;
  method: string;
  headers: Record<string, string>;
  body: RequestInit["body"];
}

export type Handler = (call: Call) => Response | Promise<Response>;

export function json(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

/** Respuesta con el sobre de error de la API. */
export function apiError(
  status: number,
  code: string,
  requestId = "req-1",
  headers: Record<string, string> = {},
): Response {
  return json(status, { error: { code, message: `mensaje de ${code}`, requestId } }, headers);
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export function memoryStorage(
  initial: AuthTokens | null,
): TokenStorage & { current(): AuthTokens | null } {
  let tokens = initial;
  return {
    current: () => tokens,
    get: async () => tokens,
    set: async (next) => {
      tokens = next;
    },
    clear: async () => {
      tokens = null;
    },
  };
}

/** `fetch` falso que registra cada llamada y delega la respuesta en `handler`. */
export function fakeFetch(handler: Handler) {
  const calls: Call[] = [];
  const fetch = jest.fn(async (url: string, init: RequestInit) => {
    const call: Call = {
      path: url.slice(BASE_URL.length),
      method: init.method ?? "GET",
      headers: init.headers as Record<string, string>,
      body: init.body,
    };
    calls.push(call);
    return handler(call);
  });
  return { fetch, calls };
}

/** Backend que solo acepta `access-new` y rota el refresh token al par nuevo. */
export function rotatingBackend(refresh: Handler = () => json(200, { ...NEW_TOKENS })): Handler {
  return (call) => {
    if (call.path === "/auth/refresh") return refresh(call);
    if (call.headers.Authorization !== `Bearer ${NEW_TOKENS.accessToken}`) {
      return apiError(401, "TOKEN_EXPIRED");
    }
    return json(200, { path: call.path });
  };
}
