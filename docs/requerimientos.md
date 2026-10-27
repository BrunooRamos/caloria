# Requerimientos detallados

Detalle de los requerimientos del [RFC](RFC.md), con criterios de aceptación verificables. Endpoints en [api.md](api.md), datos en [modelo-datos.md](modelo-datos.md).

## Requerimientos funcionales

### Autenticación y perfil

#### RF-01 — Registro y login

Registro y login con email y contraseña, con sesión que se mantiene entre aperturas de la app.

- [ ] El registro pide email, contraseña y perfil inicial (RF-02) y devuelve 201 con access y refresh token.
- [ ] El email se guarda en minúsculas y es único: uno repetido devuelve 409 `EMAIL_TAKEN`.
- [ ] La contraseña tiene mínimo 8 caracteres; se guarda solo el hash bcrypt.
- [ ] Login con credenciales incorrectas devuelve 401 con el mismo mensaje sea el email o la contraseña.
- [ ] El access token dura 15 min y el refresh 30 días; la app refresca sola al recibir 401 `TOKEN_EXPIRED`.
- [ ] Reusar un refresh token ya rotado revoca toda la familia y obliga a loguearse de nuevo.
- [ ] Logout revoca los refresh tokens y borra los tokens de SecureStore.
- [ ] Al reabrir la app con un refresh válido, el usuario entra directo sin loguearse.

Endpoints: `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`.

#### RF-02 — Perfil y metas

Perfil del cual se calculan las metas diarias de kcal y macros, editable, con recálculo automático.

- [ ] El perfil tiene sexo, fecha de nacimiento, altura (cm), peso (kg), actividad (5 niveles), objetivo (bajar / mantener / subir) y zona horaria.
- [ ] Rangos válidos: edad 16–100, altura 100–250 cm, peso 30–300 kg. Fuera de rango → 400.
- [ ] Las metas se calculan con la fórmula de [modelo-datos.md](modelo-datos.md#cálculo-de-metas-rf-02) y nunca quedan por debajo de 1200 kcal.
- [ ] Al editar cualquier dato del perfil, `PATCH /users/me` devuelve las metas recalculadas en la misma respuesta.
- [ ] El onboarding de la app completa el perfil en el registro y muestra las metas resultantes.
- [ ] La función de cálculo tiene tests unitarios con casos conocidos.

Endpoints: `GET /users/me`, `PATCH /users/me`.

### Registro de comidas con IA

#### RF-03 — Registrar comida con foto

- [ ] Se puede sacar la foto con la cámara o elegirla de la galería.
- [ ] La app comprime la imagen antes de subirla (lado mayor ≤ 1600 px).
- [ ] Formatos aceptados: JPEG, PNG y HEIC; tamaño ≤ 8 MB. Si no cumple → 413 o 400.
- [ ] `POST /meals` responde 202 con `mealId` y `status: "processing"` sin esperar a la IA.
- [ ] La app muestra el estado "analizando" y se actualiza sola cuando el análisis está listo (polling o push).
- [ ] Desde la pantalla principal se registra una comida en ≤ 3 interacciones (RNF-06).

#### RF-04 — Audio opcional

- [x] La app permite grabar hasta 60 s y corta sola al llegar al límite.
- [x] Se puede escuchar, regrabar o descartar el audio antes de enviar.
- [ ] El Worker transcribe el audio y guarda el texto en `meals.transcript`.
- [ ] La transcripción y la nota (`note`) se incluyen en el prompt del análisis.
- [ ] Sin audio, el análisis funciona igual solo con la foto.

#### RF-05 — Análisis en rangos

- [ ] El análisis devuelve plato, ingredientes (con gramos y kcal en rangos), kcal total y macros (proteína, carbohidratos, grasas), todos como rangos `{ min, max }`.
- [ ] Incluye `confidence` entre 0 y 1; la app la muestra como alta / media / baja: alta desde 0,75, media desde 0,5 y baja por debajo (`CONFIDENCE_THRESHOLDS` en `app/features/meals/confidence.ts`).
- [ ] `min ≤ max` en todos los rangos; la respuesta de la IA se valida con zod y, si no cumple, el job se reintenta.
- [ ] Se guarda la versión del prompt (`promptVersion`) y el modelo usado.
- [ ] Si la foto no parece comida, el análisis vuelve `failed` con un mensaje claro y no consume cupo.

#### RF-06 — Correcciones persistentes

- [ ] El usuario puede corregir el plato, agregar / quitar / editar ingredientes y ajustar kcal y macros.
- [ ] Cada cambio se agrega a `meals.corrections` con campo, valor anterior, valor nuevo y fecha.
- [ ] Después de corregir, el historial y el dashboard usan los valores corregidos.
- [ ] Una comida de otro usuario devuelve 404.

Endpoint: `PATCH /meals/:id`.

#### RF-07 — Compounding

- [ ] Antes de llamar a la IA, el Worker busca hasta 5 comidas del mismo usuario con plato o ingredientes similares que tengan correcciones.
- [ ] Esas comidas (plato, valores finales y qué se corrigió) se incluyen en el prompt como contexto.
- [ ] Primera versión: similitud por texto (nombre del plato e ingredientes, búsqueda full-text de Mongo). Embeddings solo si sobra tiempo.
- [ ] Prueba de aceptación: corregir un plato y volver a registrar uno parecido da un rango más cercano a la corrección que el primer análisis.

#### RF-08 — Historial por día

- [ ] La app muestra las comidas de un día, ordenadas por hora, con navegación a días anteriores.
- [ ] El "día" se calcula en la zona horaria del usuario.
- [ ] Se puede ver el detalle, editar (RF-06) y eliminar una comida.
- [ ] Eliminar borra el documento y su media del bucket (204).
- [ ] La lista está paginada por cursor (20 por página).

Endpoints: `GET /meals?date=&cursor=`, `GET /meals/:id`, `DELETE /meals/:id`.

### Dashboard y retención

#### RF-09 — Dashboard diario

- [ ] Muestra kcal y macros consumidos del día contra la meta, con barra de progreso.
- [ ] El consumido se muestra como rango (suma de mínimos y de máximos) y con un valor central (punto medio) para la barra.
- [ ] Solo suman las comidas en estado `ready`; las que están en `processing` se indican aparte.
- [ ] Se actualiza al volver a la pantalla después de registrar, corregir o borrar una comida.
- [ ] Respuesta de `GET /dashboard/daily` en < 1 s (RNF-01).

#### RF-10 — Racha

- [ ] Un día cuenta para la racha si tiene al menos una comida registrada (en la zona horaria del usuario).
- [ ] La racha actual sube en 1 con el primer registro de un día consecutivo; si se saltea un día, vuelve a 1.
- [ ] Se guarda la racha máxima histórica.
- [ ] Borrar comidas no recalcula rachas pasadas.
- [ ] El dashboard muestra la racha actual y la máxima.

### IA

#### RF-11 — Comentario con personalidad

- [ ] El usuario elige el tono en su perfil: motivador, neutro, roast o desactivado. Default: motivador.
- [ ] Con un tono activo, cada análisis incluye un comentario corto (≤ 200 caracteres) en ese tono.
- [ ] Con el tono desactivado no se genera comentario (y no se gasta la llamada).
- [ ] El prompt prohíbe comentarios sobre el cuerpo, el peso o la apariencia, y no incentiva la restricción (RNF-10). Se prueba con un set de comidas "problemáticas".

#### RF-12 — Wrapped semanal

- [ ] Un cron corre los lunes a las 06:00 (zona del usuario o UTC-3 en v1) y genera el resumen de la semana anterior para cada usuario con al menos un registro.
- [ ] Métricas: promedio de kcal, días registrados, racha, plato más frecuente.
- [ ] La IA genera 3 a 5 insights sobre hábitos, con las mismas reglas de RNF-10.
- [ ] Se guarda en `weekly_summaries`; si ya existe la semana, no se duplica.
- [ ] La app lo muestra como tarjetas y permite compartir cada tarjeta como imagen.
- [ ] Al terminar, se envía el push "Wrapped listo".

#### RF-13 — Push notifications

- [ ] La app pide permiso de notificaciones y registra el push token con `PATCH /users/me`.
- [ ] Notificaciones: análisis listo, racha en riesgo (20:00 si no hubo registro en el día y la racha es ≥ 2) y Wrapped listo.
- [ ] El usuario puede desactivar cada tipo de notificación.
- [ ] Los tokens inválidos que devuelve Expo se eliminan del usuario.

### Freemium

#### RF-14 — Planes

- [ ] Plan free: N análisis por mes calendario. Premium: análisis ilimitados y Wrapped completo.
- [ ] El contador se reinicia el día 1 de cada mes.
- [ ] Un análisis que termina en `failed` no consume cupo: el conteo del mes excluye las comidas `failed`. Así una foto que no es comida (`error.code: "NOT_FOOD"`, #18) no gasta un análisis.
- [ ] La app muestra los análisis restantes del mes.

#### RF-15 — Feature gating en la API

- [ ] `POST /meals` verifica el cupo en el Backend antes de encolar: sin cupo → 402 `MEAL_QUOTA_EXCEEDED`.
- [ ] Las funciones premium se verifican en el Backend: sin plan → 402 `PREMIUM_REQUIRED`.
- [ ] Modificar el cliente no permite saltear los límites (se prueba llamando a la API directamente).

#### RF-16 — Suscripción

- [ ] La app muestra el precio y qué incluye cada plan antes de suscribirse, sin pasos ocultos.
- [ ] El alta premium se procesa con un proveedor de pagos en modo sandbox.
- [ ] El usuario ve su plan, la fecha de renovación y puede cancelar desde la app.
- [ ] Al cancelar, mantiene premium hasta el fin del período pagado.
- [ ] La integración de pago está detrás de un service (`services/billing`) que permite cambiar a un proveedor real.

Endpoints: `GET /billing/plan`, `POST /billing/subscribe`.

## Requerimientos no funcionales

| RNF | Requerimiento | Métrica / criterio | Cómo se verifica |
|---|---|---|---|
| RNF-01 | Rendimiento | Análisis foto + audio en < 15 s (p90) con indicador de progreso; navegación y endpoints de lectura en < 1 s | Logs de duración por job; medición sobre 20 registros de prueba |
| RNF-02 | Resiliencia | Si la IA falla, el job reintenta 3 veces con backoff exponencial; si sigue fallando, `failed` y aviso al usuario. La media subida nunca se pierde | Test cortando la API de IA (clave inválida) y verificando reintentos |
| RNF-03 | Seguridad | HTTPS en todo el tráfico; HTTP redirige a HTTPS; Front → Backend por HTTPS con mTLS | Revisión de config de nginx; `curl` a HTTP y a puertos internos |
| RNF-04 | Privacidad | Bucket privado con URLs firmadas (≤ 15 min); `DELETE /users/me` borra todo | Abrir una URL vencida; borrar una cuenta de prueba y verificar Mongo y bucket |
| RNF-05 | Arquitectura asincrónica | Análisis y Wrapped corren en el Worker vía Redis; la API responde 202 en < 1 s | Test de `POST /meals` con el Worker apagado: responde 202 y queda encolado |
| RNF-06 | Usabilidad | Registrar una comida en ≤ 3 interacciones desde la pantalla principal | Recorrido manual documentado |
| RNF-07 | Costos de IA | Rate limit por plan; cache por hash de la foto; costo por usuario activo estimado y registrado | Log de tokens/costo por llamada; planilla de costo estimado |
| RNF-08 | Calidad | TypeScript estricto, ESLint, PRs con ≥ 1 revisión, CI en verde, README reproducible | GitHub Actions; un integrante levanta el proyecto desde cero con el README |
| RNF-09 | Portabilidad | iOS y Android desde la misma base Expo | Prueba del flujo central en un dispositivo de cada plataforma |
| RNF-10 | Contenido responsable | Sin juicios sobre el cuerpo ni fomento de restricción; metas ≥ 1200 kcal; aviso de que la app no es consejo médico | Set de prueba de prompts; aviso visible en el onboarding |

## Decisiones abiertas

1. **Datos del perfil:** el esquema de `users` de la presentación solo tiene altura, peso y objetivo, pero RF-02 pide edad y actividad, y la fórmula de metas necesita sexo. En estos documentos se agregaron `sex`, `birthDate`, `activity` y `timezone`.
2. **Metas de macros:** la presentación guarda solo `kcal` y `proteinG`, pero RF-09 muestra todos los macros. Se agregaron `carbsG` y `fatG`.
3. **Valor de N:** cuántos análisis por mes tiene el plan free (RF-14).
4. **Qué ve el free del Wrapped:** el premium tiene "Wrapped completo", pero no está definido qué parte ve el free.
5. **Precio del premium** y proveedor de pagos sandbox (Stripe test mode, Mercado Pago sandbox).
6. **Código HTTP para cupo agotado:** la presentación no lo define. Se propone 402.
7. **Cancelar suscripción:** RF-16 lo pide, pero no hay endpoint. Se propone `POST /billing/cancel`.
8. **Preferencias de notificaciones:** dónde se guardan (se propone `users.notifications`).
9. **mTLS entre Front y Backend:** la presentación lo plantea, pero el `docker-compose` actual usa HTTP. Decidir si se implementa o queda para producción.
10. **Dominio y hosting:** el RFC dice "si conseguimos un dominio barato" y la presentación usa `api.caloria.app` y DigitalOcean. El despliegue está marcado como "a definir".
11. ~~**Proveedor de IA:** qué modelos de visión, transcripción y texto se usan.~~ Resuelto en #18: OpenAI. Visión con la Responses API y structured outputs, modelo en `OPENAI_VISION_MODEL` (por defecto `gpt-6-luna`). Los modelos de transcripción y texto se eligen en sus issues.
12. ~~**Storage:** qué bucket se usa (S3, DigitalOcean Spaces, MinIO en local).~~ Resuelto en #14: MinIO en local y bucket compatible con S3 en prod (DO Spaces previsto); el código usa el SDK de S3.
