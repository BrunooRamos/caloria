# Prompts de pazdiaz15

## Sesión `2b4eb0f7-d8f1-4653-85c8-a201de365346` · 2026-10-12

### 2026-10-12 19:35

```text
Implementá el ticket: "Sobre de error único y requestId en Front y Back". Middleware de errores común para toda la API.
Referencia: `docs/api.md`. Revisá cómo están armados hoy el Front Service y el Backend antes de empezar, y reutilizá lo que ya exista (logger, paquete compartido, wrapper async).
Criterios de aceptación:
- Todas las respuestas de error de ambos servicios tienen la forma `{ error: { code, message, requestId } }`.
- El Front genera el `requestId` y lo propaga al Backend con `X-Request-Id`.
- El `requestId` aparece en los logs de ambos servicios.
- Nunca se exponen stack traces en las respuestas.
Decisiones:
- Catálogo de códigos y `AppError` en un módulo compartido por ambos servicios; el status se deriva del `code`, tipado como unión cerrada.
- El Front siempre genera un UUID nuevo e ignora el `X-Request-Id` que mande el cliente. También lo devuelve en el header de respuesta.
- El Backend usa el `X-Request-Id` recibido; si falta o es inválido, genera uno y loguea un warning.
- El middleware de errores mapea `AppError`, `ZodError` (400), JSON malformado (400), límite de tamaño o multer (413) y rutas inexistentes (404). Cualquier otro error → 500 con mensaje genérico, nunca `err.message`.
- Los errores del Backend con sobre válido pasan por el Front sin modificar. Si el Backend no responde o devuelve algo inválido, el Front responde su propio sobre (503 si no está alcanzable, 500 si no).
- Logs estructurados con `requestId` en cada línea. Stack trace solo en el log de los 5xx. Sin PII: nada de emails, passwords, tokens, bodies ni el header `Authorization`.
- Reemplazá las respuestas de error armadas a mano por `throw new AppError(...)`, sin cambiar otra lógica.

Cubrí cada criterio de aceptación, más: error inesperado sin filtrar el mensaje ni el stack, `X-Request-Id` del cliente ignorado, mismo requestId en Front y Backend, error del Backend que pasa intacto y Backend caído.
```
