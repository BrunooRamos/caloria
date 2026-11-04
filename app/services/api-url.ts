/**
 * La URL base de la API (`EXPO_PUBLIC_API_URL`). Fuera de desarrollo tiene que ser `https`:
 * un build de release con `http` no arranca, en vez de mandar tokens, fotos y audios sin cifrar.
 * En desarrollo se acepta `http`, para el nginx local en el 8080.
 */
export function apiBaseUrl(value: string | undefined, dev: boolean): string {
  if (!value) {
    throw new Error("Falta EXPO_PUBLIC_API_URL: copiá app/.env.example a app/.env y completala.");
  }
  if (!dev && !/^https:\/\//i.test(value)) {
    throw new Error(`EXPO_PUBLIC_API_URL tiene que ser https fuera de desarrollo (es ${value}).`);
  }
  return value;
}
