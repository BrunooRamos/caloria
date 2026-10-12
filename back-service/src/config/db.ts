import mongoose from "mongoose";

const RETRY_MS = 5000;

// Mongoose reconecta solo si Mongo se cae después de conectar.
// Si al arrancar todavía no está listo (ej. el contenedor reinicia), reintentamos.
export async function connectMongo(uri = process.env.MONGO_URI): Promise<void> {
  if (!uri) throw new Error("Falta MONGO_URI");

  mongoose.connection.on("disconnected", () => console.warn("mongo desconectado"));
  mongoose.connection.on("reconnected", () => console.log("mongo reconectado"));

  for (;;) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
      console.log("mongo conectado");
      return;
    } catch (err) {
      console.error(
        `no se pudo conectar a mongo, reintento en ${RETRY_MS / 1000}s:`,
        (err as Error).message,
      );
      await new Promise((r) => setTimeout(r, RETRY_MS));
    }
  }
}

const STATES: Record<number, string> = {
  0: "disconnected",
  1: "connected",
  2: "connecting",
  3: "disconnecting",
};

export function mongoStatus(): string {
  return STATES[mongoose.connection.readyState] ?? "unknown";
}
