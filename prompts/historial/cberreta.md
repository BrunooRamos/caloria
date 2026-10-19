# Prompts de cberreta

## Sesión `c16234ef-8fee-425d-972a-c1c7fea7a75c` · 2026-10-14

### 2026-10-14 19:11

```text
Necesito que armes la base de navegación y comunicación con la API en la app Expo (`app/`). Antes de tocar nada, leé `docs/api.md`, `docs/seguridad.md` y la sección de organización del repo en `docs/arquitectura.md`, y revisá `app/package.json` para ver qué versiones de Expo y expo-router tenemos y qué librerías ya están instaladas. Ahí está el contrato de los endpoints de `/auth`, el formato del sobre de error y cómo funciona la rotación de refresh tokens, que es clave para este ticket.

Lo que tiene que quedar es esto: la navegación con expo-router separada en un grupo de auth (login y registro) y un grupo con sesión, donde por ahora alcanza con una home placeholder con un botón de logout. Las pantallas de login y registro pueden ser mínimas mientras funcionen; el onboarding con el perfil completo y el diseño final van en otro ticket. Protegé los grupos de la forma que corresponda a la versión de expo-router instalada.

El cliente HTTP va en `app/services/` y la URL base tiene que salir de una variable de entorno (`EXPO_PUBLIC_API_URL`), con un `.env.example` que lo documente, incluyendo que en el emulador de Android `localhost` es `10.0.2.2`. Quiero que el cliente sea tipado, agregue el Bearer, convierta el sobre de error de la API en un error propio con status, code, message y requestId, y que soporte `FormData`, porque lo siguiente que viene es `POST /meals` con multipart. Si no hay ya una librería instalada para esto, prefiero un wrapper sobre `fetch` antes que sumar dependencias.

Los tokens se guardan en `expo-secure-store`. Cuando una request vuelve con 401 y código `TOKEN_EXPIRED` (no cualquier 401: `UNAUTHORIZED` no tiene que disparar nada), el cliente refresca, guarda el par nuevo y reintenta esa request una sola vez. Si el refresh falla, se limpia la sesión y la app vuelve al login. Hay un detalle importante acá: el backend rota el refresh token en cada uso y, si detecta que se reusa uno viejo, revoca toda la familia. Eso significa que si varias requests reciben `TOKEN_EXPIRED` al mismo tiempo no pueden lanzar cada una su propio refresh, porque nos cerraríamos la sesión solos. Tiene que haber un único refresh en vuelo y las demás requests tienen que esperarlo. Tampoco tiene sentido intentar refrescar sobre los propios endpoints de `/auth`.

La sesión debería vivir en un store o contexto (en `app/store/` o `features/auth/`, lo que encaje mejor con lo que ya hay), con un estado de cargando, autenticado y no autenticado. El cliente HTTP necesita poder avisarle al store cuando la sesión expiró sin que los dos módulos queden importándose mutuamente. El logout llama a `/auth/logout` sin bloquear si falla y borra los tokens.

Al abrir la app, mientras se lee SecureStore, mantené el splash. Si hay un refresh token, probá refrescar: si anda, entra directo al grupo con sesión; si no, limpia y va al login. No quiero que se vea por un instante la pantalla equivocada.

Sumá tests del cliente HTTP con `fetch` mockeado que cubran el refresh exitoso con reintento, el refresh fallido que termina en logout, dos requests concurrentes que generan un solo refresh, y que un 401 que no es `TOKEN_EXPIRED` no refresque. Todo en TypeScript estricto, con lint y typecheck en verde.

Antes de implementar, contame tu plan: qué archivos vas a crear o modificar y qué decisiones tomaste, y esperá mi OK.
```
