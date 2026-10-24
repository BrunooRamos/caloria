import { ApiError, apiErrorFromResponse, parseRetryAfter } from "./api-error";
import { parseTokens } from "./token-storage";
import type { AuthTokens, TokenStorage } from "./token-storage";

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface RequestOptions {
  method?: HttpMethod;
  body?: object;
  headers?: Record<string, string>;
  auth?: boolean;
  signal?: AbortSignal;
}

export type MethodOptions = Omit<RequestOptions, "method" | "body">;

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export interface HttpClientConfig {
  baseUrl: string;
  storage: TokenStorage;
  fetch?: FetchFn;
}

export interface HttpClient {
  request<T = unknown>(path: string, options?: RequestOptions): Promise<T>;
  get<T = unknown>(path: string, options?: MethodOptions): Promise<T>;
  post<T = unknown>(path: string, body?: object, options?: MethodOptions): Promise<T>;
  patch<T = unknown>(path: string, body?: object, options?: MethodOptions): Promise<T>;
  delete<T = void>(path: string, options?: MethodOptions): Promise<T>;
  refreshSession(): Promise<AuthTokens>;
  clearSession(): Promise<void>;
  onSessionExpired(listener: () => void): () => void;
}

const REFRESH_PATH = "/auth/refresh";
const INVALID_JSON = Symbol("INVALID_JSON");

function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

function isAuthPath(path: string): boolean {
  return path === "/auth" || path.startsWith("/auth/");
}

function isTokenExpired(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401 && error.code === "TOKEN_EXPIRED";
}

function isRefreshRejected(error: unknown): boolean {
  return (
    error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 429
  );
}

function noSessionError(): ApiError {
  return new ApiError({
    status: 401,
    code: "UNAUTHORIZED",
    message: "No hay una sesión activa",
    requestId: null,
  });
}

function parsePayload(text: string): unknown {
  if (text === "") return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return INVALID_JSON;
  }
}

export function createHttpClient({
  baseUrl,
  storage,
  fetch: fetchFn = (url, init) => fetch(url, init),
}: HttpClientConfig): HttpClient {
  const root = baseUrl.replace(/\/+$/, "");
  const listeners = new Set<() => void>();
  let refreshInFlight: Promise<AuthTokens> | null = null;
  let sessionEpoch = 0;

  async function send<T>(
    path: string,
    options: RequestOptions,
    accessToken: string | null,
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json", ...options.headers };
    let body: FormData | string | undefined;
    if (options.body instanceof FormData) {
      body = options.body;
    } else if (options.body !== undefined) {
      body = JSON.stringify(options.body);
      headers["Content-Type"] = "application/json";
    }
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    let response: Response;
    let text: string;
    try {
      response = await fetchFn(`${root}${path}`, {
        method: options.method ?? "GET",
        headers,
        body,
        signal: options.signal,
      });
      text = await response.text();
    } catch (cause) {
      if (options.signal?.aborted) throw cause;
      throw new ApiError({
        status: 0,
        code: "NETWORK_ERROR",
        message: "No se pudo conectar con el servidor",
        requestId: null,
        cause,
      });
    }

    const payload = parsePayload(text);
    const requestId = response.headers.get("X-Request-Id");
    if (!response.ok) {
      throw apiErrorFromResponse(response.status, payload, {
        requestId,
        retryAfterSeconds: parseRetryAfter(response.headers.get("Retry-After")),
      });
    }
    if (payload === INVALID_JSON) {
      throw new ApiError({
        status: response.status,
        code: "UNKNOWN_ERROR",
        message: "Respuesta inesperada del servidor",
        requestId,
      });
    }
    return payload as T;
  }

  async function clearSession(): Promise<void> {
    sessionEpoch += 1;
    await storage.clear();
  }

  async function runRefresh(): Promise<AuthTokens> {
    const epoch = sessionEpoch;
    const tokens = await storage.get();
    if (!tokens) throw noSessionError();

    let renewed: AuthTokens | null;
    try {
      const payload = await send<unknown>(
        REFRESH_PATH,
        { method: "POST", body: { refreshToken: tokens.refreshToken } },
        null,
      );
      renewed = parseTokens(payload);
    } catch (error) {
      if (epoch === sessionEpoch && isRefreshRejected(error)) {
        try {
          await clearSession();
        } finally {
          listeners.forEach((listener) => listener());
        }
      }
      throw error;
    }

    if (epoch !== sessionEpoch) throw noSessionError();
    if (!renewed) {
      throw new ApiError({
        status: 200,
        code: "UNKNOWN_ERROR",
        message: "Respuesta inesperada del servidor",
        requestId: null,
      });
    }
    await storage.set(renewed);
    return renewed;
  }

  function refreshSession(): Promise<AuthTokens> {
    refreshInFlight ??= runRefresh().finally(() => {
      refreshInFlight = null;
    });
    return refreshInFlight;
  }

  async function renewAccessToken(expiredAccessToken: string): Promise<AuthTokens> {
    const current = await storage.get();
    if (current && current.accessToken !== expiredAccessToken) return current;
    return refreshSession();
  }

  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const target = normalizePath(path);
    if (options.auth === false) return send<T>(target, options, null);

    const tokens = await storage.get();
    try {
      return await send<T>(target, options, tokens?.accessToken ?? null);
    } catch (error) {
      if (!tokens || !isTokenExpired(error) || isAuthPath(target)) throw error;
      const renewed = await renewAccessToken(tokens.accessToken);
      return send<T>(target, options, renewed.accessToken);
    }
  }

  return {
    request,
    get: (path, options) => request(path, { ...options, method: "GET" }),
    post: (path, body, options) => request(path, { ...options, method: "POST", body }),
    patch: (path, body, options) => request(path, { ...options, method: "PATCH", body }),
    delete: (path, options) => request(path, { ...options, method: "DELETE" }),
    refreshSession,
    clearSession,
    onSessionExpired(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
