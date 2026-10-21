const STORAGE_VARS = {
  endpoint: "S3_ENDPOINT",
  publicEndpoint: "S3_PUBLIC_ENDPOINT",
  region: "S3_REGION",
  bucket: "S3_BUCKET",
  accessKeyId: "S3_ACCESS_KEY_ID",
  secretAccessKey: "S3_SECRET_ACCESS_KEY",
} as const;

export type StorageConfig = Record<keyof typeof STORAGE_VARS, string>;

/** Config del bucket de media, compartida por Backend y Worker. Lanza si falta algo. */
export function loadStorageConfig(env = process.env): StorageConfig {
  const entries = Object.entries(STORAGE_VARS).map(([key, name]) => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`Falta la variable de entorno ${name}`);
    return [key, value];
  });
  return Object.fromEntries(entries) as StorageConfig;
}
