# Plan del proyecto

Plan para construir CalorIA según el [RFC](RFC.md). Entrega final: **miércoles 18 de noviembre de 2026**.

## Metodología

Scrum liviano, con sprints de **1 semana** que van de clase a clase.

- **Planning (en clase):** se eligen las historias del sprint desde el backlog, priorizadas por la tabla de avance.
- **Daily asincrónica:** un mensaje corto en el grupo con qué hice, qué voy a hacer y qué me bloquea.
- **Review + retro (en clase):** demo de lo terminado sobre `main` y un punto de mejora para el próximo sprint.
- **Tablero:** GitHub Projects con las columnas Backlog → To do → In progress → In review → Done. Cada issue referencia su RF/RNF (ej. `RF-07`).
- **Flujo de código:** una rama por issue (`feat/rf-07-compounding`), PR a `main` con al menos 1 revisión de otro integrante, lint y typecheck en verde (RNF-08).
- **Definition of Done:** mergeado a `main`, anda con `docker compose up`, cubre los criterios del RF y tiene el README/prompt actualizado si corresponde.

## Avance por clase

| Fecha | Avance esperado |
|-------|-----------------|
| 30/09 | RFC cerrado, esqueleto del repo (app, BFF, back, worker, infra) levantando con docker compose, plan del proyecto y tablero armado |
| 07/10 | **Base:** registro/login con JWT de punta a punta (RF-01), perfil con cálculo de metas (RF-02), modelos Mongo, CI con lint y typecheck, pantallas de auth y onboarding |
| 14/10 | **Primer análisis:** foto → bucket privado → job en cola → análisis IA con rangos y confianza (RF-03, RF-05, RNF-04, RNF-05); pantalla de captura y resultado |
| 21/10 | **Audio + correcciones:** audio de hasta 60 s transcrito como contexto (RF-04), edición y persistencia de correcciones (RF-06), historial por día (RF-08), dashboard diario (RF-09). **MVP usable** |
| 28/10 | **Compounding + retención:** recuperación de platos similares inyectada al prompt (RF-07), rachas (RF-10), comentario con personalidad/roast (RF-11), reintentos si falla la IA (RNF-02) |
| 04/11 | **Wrapped + push + freemium:** cron semanal con tarjetas compartibles (RF-12), push notifications (RF-13), límites por plan y gating en la API (RF-14, RF-15), suscripción en sandbox (RF-16) |
| 11/11 | **Hardening:** HTTPS (RNF-03), rate limiting y caching de IA (RNF-07), borrado de cuenta (RNF-04), medición de tiempos (RNF-01), revisión de tono (RNF-10), pruebas en iOS y Android. **Feature freeze** |
| 18/11 | **Entrega final:** README reproducible, demo en vivo, bugs corregidos, documentación actualizada |

## Hitos

| Hito | Fecha | Criterio de cumplimiento |
|------|-------|--------------------------|
| H0 — Kickoff | 30/09 | RFC aprobado, repo con esqueleto levantando en docker compose, plan y tablero listos |
| H1 — Flujo de punta a punta | 14/10 | Un usuario logueado saca una foto desde la app y recibe un análisis IA con rangos, pasando por todas las capas (app → nginx → BFF → back → worker) |
| H2 — MVP | 21/10 | Registrar comidas con foto + audio, corregirlas, ver el historial y el dashboard diario contra la meta. |
| H3 — Funcionalidad completa | 04/11 | Todos los RF del RFC implementados: compounding, rachas, roast, Wrapped, push y freemium |
| H4 — Feature freeze | 11/11 | No entran funcionalidades nuevas; RNF verificados (HTTPS, tiempos, costos, privacidad) y app probada en iOS y Android |
| H5 — Entrega final | 18/11 | Demo en vivo, README reproducible y documentación (RFC, plan, prompts) actualizada |

## Riesgos

| Riesgo | Prob. | Impacto | Mitigación |
|--------|-------|---------|------------|
| Precisión de la IA peor de lo esperado en platos caseros | Alta | Alto | Rangos honestos en vez de números exactos, audio como contexto, set de ~20 fotos de prueba para comparar prompts cada sprint |
| Costos de las APIs de IA durante el desarrollo | Media | Medio | Modelos baratos en dev, cache de respuestas para fotos repetidas, tope de gasto en cada proveedor, rate limit por usuario (RNF-07) |
| Latencia mayor a 15 s (foto + audio + IA) | Media | Medio | Procesamiento asincrónico con indicador de progreso, compresión de imagen en el cliente, transcripción en paralelo al upload |
| Compounding difícil de implementar bien (búsqueda de similares) | Media | Medio | Primera versión por nombre de plato e ingredientes; embeddings solo si sobra tiempo |
| Integración entre capas (app ↔ BFF ↔ back ↔ worker) tardía | Media | Alto | Flujo de punta a punta mínimo ya en la clase del 14/10, contratos de API definidos en `front-service/src/schemas` |
| Push notifications y builds nativos en Expo (certificados, dispositivos) | Media | Medio | Usar Expo Go/EAS desde temprano y probar push en un dispositivo real antes del 04/11 |
| No conseguir un dominio para HTTPS (RNF-03) | Media | Bajo | Certificado autofirmado en `infra/certs` o un túnel (Cloudflare/ngrok) para la demo |
