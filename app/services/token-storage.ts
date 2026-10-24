import * as SecureStore from "expo-secure-store";

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface TokenStorage {
  get(): Promise<AuthTokens | null>;
  set(tokens: AuthTokens): Promise<void>;
  clear(): Promise<void>;
}

export function parseTokens(value: unknown): AuthTokens | null {
  if (typeof value !== "object" || value === null) return null;
  const { accessToken, refreshToken } = value as Record<string, unknown>;
  if (typeof accessToken !== "string" || typeof refreshToken !== "string") return null;
  return { accessToken, refreshToken };
}

const SESSION_KEY = "caloria.session";

function decode(raw: string | null): AuthTokens | null {
  if (raw === null) return null;
  try {
    return parseTokens(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function createSecureTokenStorage(): TokenStorage {
  let cache: AuthTokens | null | undefined;

  return {
    async get() {
      if (cache !== undefined) return cache;
      const stored = decode(await SecureStore.getItemAsync(SESSION_KEY));
      if (cache === undefined) cache = stored;
      return cache;
    },
    async set(tokens) {
      cache = tokens;
      await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(tokens));
    },
    async clear() {
      cache = null;
      await SecureStore.deleteItemAsync(SESSION_KEY);
    },
  };
}
