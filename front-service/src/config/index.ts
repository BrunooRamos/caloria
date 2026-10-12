export const config = {
  port: Number(process.env.PORT) || 3000,
  backendUrl: process.env.BACKEND_URL ?? "http://localhost:4000",
  backendTimeoutMs: Number(process.env.BACKEND_TIMEOUT_MS) || 10_000,
};
