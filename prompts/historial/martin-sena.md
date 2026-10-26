# Prompts de Martin Sena

## Sesión `957c1600-dbba-4800-9aa3-172966136e04` · 2026-10-21

### 2026-10-21 14:08

```text
Tenemos que implementar este ticket: https://github.com/BrunooRamos/caloria/issues/14, vamos a planificar como tenemos que hacerlo, discutamos decisiones hasta llegar a un plan de implementacion
```

### 2026-10-21 14:19

```text
Perfecto, guarda el plan el prompts/plans linkeado al issue con su nombre
```

### 2026-10-21 14:21

```text
Aprobado el plan, implementalo.
```

## Sesión `1c274a6e-d7ce-478e-aa0a-bf31c5c76a66` · 2026-10-25

### 2026-10-25 21:17

```text
Che, estoy en la rama `front-y-nginx-multipart-con-l-mites-de-tama-o-y`, que es del issue #16 (multipart con límites de tamaño y tipo). Fijate el issue con `gh issue view 16`.

Ojo que casi todo ya quedó hecho en el PR #66 (el de post-meals): la validación por contenido en `shared/src/meals.ts`, multer en memoria en el front, el reenvío al back y el 413 en nginx. No lo rehagas. Faltan unas puntas que quiero cerrar:

1. **nginx está escribiendo la foto a disco.** En la location de `/api/v1/meals` el `client_body_buffer_size` quedó en el default, así que todo lo que pase de 16 KB va a un archivo temporal. Quiero que quede en memoria, así que subilo a 13m como el `client_max_body_size`. Dejá el buffering prendido (nada de `proxy_request_buffering off`), así nginx sigue bancando a los clientes lentos.

2. **Nunca probamos la config de nginx.** Agregá algo al CI que corra `nginx -t` (con `--add-host front:127.0.0.1` para que resuelva el upstream). Sumale un smoke test con curl: un POST de más de 13 MB a `/api/v1/meals` tiene que devolver 413 con el JSON de `PAYLOAD_TOO_LARGE` y un `requestId` igual al header `X-Request-Id`. Uno chico tiene que pasar. Si queda más prolijo como script en `scripts/`, metelo ahí, pero que lo pueda correr local con Docker.

3. **Una nota larga a veces da 400 y a veces 413.** Entre 501 y 2000 caracteres zod la rechaza con 400, pero arriba de 2000 salta el `LIMIT_FIELD_VALUE` de multer y sale 413. En `docs/api.md` dijimos que nota larga es 400. Corregilo en `toAppError` (`shared/src/error-handler.ts`) y agregá tests en shared y en front. Fijate también que no se rompa nada en los tests del back.

Lo de AAC suelto no lo toques: la app graba m4a y el back necesita el `moov` para leer la duración.

Mantené el estilo del repo (comentarios cortitos en español) y, si cambia algo documentado, actualizá los docs. Cuando termines, corré lint, typecheck y los tests, y pasame cómo salieron. No commitees todavía, que lo quiero revisar antes.
```
