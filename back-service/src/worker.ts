import { loadStorageConfig } from "./config/storage";

// Acá se consumirá la cola de Redis (trabajos de IA). Sin config de storage el worker no arranca.
loadStorageConfig();
console.log("worker listo");
