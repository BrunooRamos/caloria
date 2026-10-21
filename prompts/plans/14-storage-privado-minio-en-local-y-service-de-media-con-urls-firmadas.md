---
autor: Martin Sena
version: 0.1
fecha: 2026-10-21
issue: https://github.com/BrunooRamos/caloria/issues/14
proposito: Plan de implementación del issue #14 — Storage privado: MinIO en local y service de media con URLs firmadas.
---

# Plan · #14 Storage privado: MinIO en local y service de media con URLs firmadas

Issue: [BrunooRamos/caloria#14](https://github.com/BrunooRamos/caloria/issues/14) · RNF-04 · `back-service`, `infra`

## Criterios de aceptación

- [ ] MinIO en `docker-compose` dentro de la red interna, sin puertos públicos
- [ ] `services/media` con subir, borrar y generar URL firmada (≤ 15 min)
- [ ] El bucket no permite acceso público
- [ ] Credenciales solo en Backend y Worker

## Decisiones

| Tema | Decisión | Por qué |
|---|---|---|
| Cómo llega la app a la URL firmada | Se firma contra `S3_PUBLIC_ENDPOINT` con un segundo `S3Client` que solo firma (no hace llamadas de red). En prod es el bucket gestionado (Spaces/S3). En local, un `docker-compose.override.yml` de dev publica MinIO en `127.0.0.1:9000` | La firma SigV4 incluye el host. Así se mantiene "Front → Back es el único cruce DMZ → red segura" y el compose base queda sin puertos |
| Creación del bucket | Contenedor `minio-init` (`minio/mc`) que se puede correr varias veces | Back y Worker nunca tienen credenciales root ni permisos de administración |
| SDK | `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, `forcePathStyle: true` | El mismo código sirve para MinIO, S3 y DO Spaces |
| Tests | Unit tests offline más un test de integración opt-in (`S3_TEST_ENDPOINT`) | Firmar una URL no usa la red; CI hoy no tiene MinIO |
| `/health` | No reporta el estado del storage por ahora | Sin MinIO solo falla la subida de media; no hace falta marcar todo el servicio como degraded |

Alternativas descartadas para la URL firmada:
- nginx haciendo proxy de `/media/`: conecta la DMZ con el storage.
- El Back sirviendo la media en streaming: carga al Back con todo el tráfico de imágenes y prod no aprovecha el CDN del bucket.

## Plan de implementación

### 1. Infra

**`infra/docker-compose.yml`**
- `minio` en la red `interna`, sin `ports:`, con un volumen `minio-data`. Usa `MINIO_ROOT_USER` y `MINIO_ROOT_PASSWORD` desde `.env`.
- `minio-init` (`minio/mc`): espera a que MinIO responda, crea el bucket `caloria-media` y le pone `mc anonymous set none`. Además crea un usuario de servicio con una policy limitada al bucket:
  - `s3:GetObject`, `s3:PutObject` y `s3:DeleteObject` sobre `arn:aws:s3:::caloria-media/*`
  - `s3:ListBucket` sobre `arn:aws:s3:::caloria-media`
- `back` y `worker`: `depends_on: minio-init (condition: service_completed_successfully)` y las variables `S3_*` con la credencial de servicio.
- `front`: no recibe ninguna variable `S3_*`.
- Las credenciales root quedan solo en `minio` y `minio-init`.
- Fijar los tags de `minio/minio` y `minio/mc`, porque `mc admin policy` cambió de sintaxis entre versiones.

**`infra/docker-compose.override.yml`** (solo dev)
- Publica `127.0.0.1:9000:9000` y fija `S3_PUBLIC_ENDPOINT=http://localhost:9000` en `back` y `worker`.
- Para probar desde un teléfono real hay que usar la IP de la LAN en las dos cosas (documentarlo).

### 2. Config

**`back-service/src/config/storage.ts`**: `loadStorageConfig(env)`.
- Variables: `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
- Si falta alguna, lanza error y el servicio no arranca.
- `loadConfig` la incluye, y `worker.ts` la llama directamente.

Además, actualizar `back-service/.env.example`.

### 3. Service

**`back-service/src/services/media.ts`**: `createMediaService({ client, presignClient, bucket })`. `client` usa el endpoint interno y `presignClient` el público.

- `upload({ userId, kind: "photo" | "audio", body, contentType }) → key`
  - La key es `users/<userId>/meals/<uuid>.<ext>`.
  - El `contentType` se valida contra una lista permitida (`image/jpeg`, `image/png`, `image/heic`, `audio/m4a`/`audio/mp4`…).
- `remove(key)`: idempotente.
- `removeUserMedia(userId)`: lista y borra en lotes todo el prefijo `users/<userId>/`. Prepara `DELETE /users/me`.
- `signedUrl(key, ttlSeconds = 900)`: si el TTL pedido es mayor que `MAX_SIGNED_URL_TTL_SECONDS = 900`, se recorta a 900.

En este ticket no se cablean rutas. El service se construye en `index.ts` y queda listo para `POST /meals`, `GET /meals/:id` y `DELETE /users/me`.

### 4. Tests

**`back-service/test/media.test.ts`** (offline)
- El host de la URL firmada es `S3_PUBLIC_ENDPOINT`.
- `X-Amz-Expires` es 900 por defecto y se recorta a 900 cuando se pide más.
- Las keys quedan bajo `users/<userId>/`.
- Se rechazan los content types no permitidos.
- Falta una variable `S3_*` → la config lanza error.

**`back-service/test/media.integration.test.ts`**: se saltea si no está definida `S3_TEST_ENDPOINT`. Recorre:
1. upload
2. GET con la URL firmada → 200
3. GET anónimo → 403
4. URL con TTL corto, ya vencida → 403
5. remove
6. `removeUserMedia`

### 5. Docs

- `docs/arquitectura.md`: storage = MinIO en local y bucket gestionado compatible con S3 en prod.
- `docs/requerimientos.md`: cerrar el punto 12 (qué bucket se usa).
- `back-service/README.md`: cómo levantar MinIO y cómo correr el test de integración.

## Cómo cubre cada criterio

| Criterio | Cómo se cumple |
|---|---|
| Sin puertos públicos | Compose base sin `ports`; el override es solo de dev y escucha en `127.0.0.1` |
| Subir, borrar, URL ≤ 15 min | `services/media.ts` con el TTL recortado a 900 s + unit tests |
| Bucket sin acceso público | `mc anonymous set none` + el GET anónimo con 403 del test de integración |
| Credenciales solo en Back y Worker | Las root solo en `minio` y `minio-init`; `front` no tiene `S3_*` |
