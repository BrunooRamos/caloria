# RFC: App móvil de tracking nutricional con IA

**Autores:** Camila Berreta, Paz Díaz, Martin Sena, Bruno Ramos

## 1. Resumen

App móvil B2C freemium para registrar comidas con una foto y un audio opcional describiendo la preparación. La IA estima calorías y macros en rangos de confianza, y aprende de las correcciones del usuario. Cada ajuste se guarda y se usa como contexto en análisis futuros de platos similares. Incluye rachas, comentarios con humor configurable ("modo roast") y un resumen semanal compartible ("Wrapped") como lo que hace Spotify.

**Stack:** Expo, Node.js + Express, MongoDB y APIs de IA (visión, transcripción, texto).

## 2. Problema

Las apps de conteo de calorías por foto (referente: Cal AI, ~15M de descargas) validaron el mercado pero fallan en tres cosas documentadas por sus propios usuarios:

1. **Precisión:** la cámara no ve el aceite, las salsas ni los rellenos; errores de 25–50% en platos caseros, presentados como números falsamente exactos.
2. **No aprenden:** las correcciones del usuario no persisten; re-escanear el mismo plato da otro número equivocado.
3. **Facturación confusa:** paywalls engañosos (Cal AI llegó a ser removida del App Store por esto).

Nuestra propuesta ataca los tres puntos: audio como contexto de lo que la cámara no ve, correcciones que persisten y componen, rangos honestos y precios claros.

## 3. Alcance

**Incluye:** registro con foto + audio, análisis IA con contexto histórico, correcciones persistentes, metas y dashboard diario, rachas, roast configurable, wrapped semanal, push notifications, freemium con feature gating.

## 4. Requerimientos funcionales

### Autenticación y perfil

- **RF-01** — Registro y login con email/contraseña.
- **RF-02** — Perfil (edad, peso, altura, actividad, objetivo) del cual se calculan metas diarias de kcal y macros, editable, con recálculo automático.

### Registro de comidas con IA

- **RF-03** — Registrar comida con foto (cámara o galería).
- **RF-04** — Audio opcional de hasta 60 s describiendo la preparación; se transcribe y se suma como contexto del análisis.
- **RF-05** — El análisis devuelve: plato, ingredientes, kcal y macros — siempre como **rangos** (ej. "450–550 kcal") con nivel de confianza.
- **RF-06** — Toda corrección del usuario (plato, ingredientes, valores) se persiste asociada al registro.
- **RF-07** — **Compounding:** al analizar una comida, el sistema recupera platos similares del historial del usuario (con sus correcciones) y los inyecta al prompt. La precisión mejora con el uso.
- **RF-08** — Historial por día: ver, editar y eliminar comidas.

### Dashboard y retención

- **RF-09** — Dashboard diario: consumido vs. meta (kcal y macros).
- **RF-10** — Racha de días consecutivos con registro.

### IA

- **RF-11** — Comentario generado por comida con personalidad configurable (motivadora / neutra / roast) y desactivable. El humor apunta a hábitos, nunca al cuerpo.
- **RF-12** — Wrapped semanal: job programado (cron) que agrega los datos de la semana, genera insights con IA y los presenta en tarjetas compartibles.
- **RF-13** — Push notifications: recordatorio de registro, racha en riesgo, Wrapped listo.

### Freemium

- **RF-14** — Plan free: N análisis/mes. Premium: ilimitados + Wrapped completo.
- **RF-15** — El feature gating se aplica en la API (no solo en el cliente).
- **RF-16** — Suscripción, estado y cancelación desde la app, con precios claros. Cobro en sandbox, arquitectura lista para un proveedor real.

## 5. Requerimientos no funcionales

- **RNF-01 — Rendimiento:** análisis completo (foto + audio) en < 15 s con indicador de progreso. Navegación en < 1 s.
- **RNF-02 — Resiliencia:** si la IA falla, el registro se encola y se notifica al completarse. Nunca se pierde la foto/audio subidos.
- **RNF-03 — Seguridad:** HTTPS en todo (si conseguimos un dominio barato).
- **RNF-04 — Privacidad:** fotos y audios en bucket privado con URLs firmadas; borrado total de cuenta y datos a pedido.
- **RNF-05 — Arquitectura asincrónica:** análisis de IA y Wrapped corren en jobs fuera del request/response de la API.
- **RNF-06 — Usabilidad:** registrar una comida en ≤ 3 interacciones desde la pantalla principal.
- **RNF-07 — Costos de IA:** rate limiting por plan, caching donde aplique, y costo estimable por usuario activo.
- **RNF-08 — Calidad:** TypeScript en cliente y servidor, linting, PRs revisados entre integrantes, README reproducible.
- **RNF-09 — Portabilidad:** iOS y Android desde una única base Expo.
- **RNF-10 — Contenido responsable:** sin juicios sobre el cuerpo ni fomento de restricción; la app no es consejo médico.
