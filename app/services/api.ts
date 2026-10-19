import { createHttpClient } from "./http-client";
import { createSecureTokenStorage } from "./token-storage";

const baseUrl = process.env.EXPO_PUBLIC_API_URL;
if (!baseUrl) {
  throw new Error("Falta EXPO_PUBLIC_API_URL: copiá app/.env.example a app/.env y completala.");
}

export const tokenStorage = createSecureTokenStorage();

/** Cliente de la app contra /api/v1, con los tokens en SecureStore. */
export const api = createHttpClient({ baseUrl, storage: tokenStorage });
