# front-service — Capa 2 · DMZ · :3000

BFF detrás de nginx: verifica JWT con la clave pública, valida con zod, compone respuestas y llama al Back Service.
No tiene `models/` ni `jobs/` a propósito: no tiene base de datos, ni claves de IA, ni clave privada.
