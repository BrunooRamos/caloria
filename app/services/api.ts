import { apiBaseUrl } from "./api-url";
import { createHttpClient } from "./http-client";
import { createSecureTokenStorage } from "./token-storage";

const baseUrl = apiBaseUrl(process.env.EXPO_PUBLIC_API_URL, __DEV__);

export const tokenStorage = createSecureTokenStorage();

/** Cliente de la app contra /api/v1, con los tokens en SecureStore. */
export const api = createHttpClient({ baseUrl, storage: tokenStorage });
