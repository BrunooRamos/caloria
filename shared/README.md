# shared — código común de front-service y back-service

Paquete `@caloria/shared`: catálogo de códigos de error, `AppError`, sobre de error, `requestId`, logger estructurado y middleware de errores (ver [docs/api.md](../docs/api.md#sobre-de-error-único)).

Los servicios lo consumen como `file:../shared`. Su `prepare` instala las dependencias de `shared` y `predev`, `prebuild`, `pretypecheck` y `pretest` lo compilan, así que no hace falta tocarlo a mano: con `npm install` en el servicio alcanza.

```ts
import { AppError } from "@caloria/shared";

throw new AppError("MEAL_QUOTA_EXCEEDED"); // 402 con el mensaje del catálogo
throw new AppError("NOT_FOUND", "Comida inexistente");
```

Para loguear dentro de una request, `req.log` ya trae el `requestId`. Desde código sin `req` (services), un logger creado con `createLogger` lo toma igual de la request en curso.
