---
autor: Bruno Ramos (BrunooRamos)
version: 0.1
fecha: 2026-11-04
issue: https://github.com/BrunooRamos/caloria/issues/39
proposito: Prompt reutilizable para implementar el issue #39. Se escribió después de terminar el PR #90, a partir de lo que resultó; no es el que se envió. Los prompts de la sesión, con la redacción corregida, están en historial/bruno.md.
---

# Tarea: permisos y preferencias de notificaciones en la app (#39, RF-13)

Implementá en `app/` la configuración de push. El Backend ya guarda los tokens y las preferencias (#38): este issue es solo de la app, salvo que encuentres algo que lo impida. En ese caso, frená y avisame.

## Antes de empezar

Leé `docs/requerimientos.md#rf-13--push-notifications` y `PATCH /users/me` en `docs/api.md`. Fijate cómo están armados Perfil, `useMe` y `services/users.ts`, y reutilizá lo que ya exista. Para la UI seguí la skill `caloria-design`.

## Criterios de aceptación

- [ ] Pide permiso y registra el token.
- [ ] Se puede activar o desactivar cada tipo de aviso.
- [ ] Tocar el aviso de análisis listo abre esa comida.

## Decisiones

- **Permiso:** se pide desde una sección "Avisos" en Perfil, cuando el usuario toca un botón, nunca al abrir la app.
  - Si el sistema ya no deja volver a preguntar, el botón abre la configuración del teléfono.
  - Si el usuario lo activa desde ahí y vuelve a la app, el token se registra solo.
- **Token:** se manda solo el de este dispositivo, porque el Backend los suma. Si el permiso ya está dado, se vuelve a registrar al entrar, sin preguntar.
- **Preferencias:** un interruptor por tipo (comida analizada, racha en riesgo, resumen semanal). Cada uno se guarda al tocarlo y manda solo su tipo. Si falla, vuelve al valor guardado y muestra el error.
- **Al tocar un aviso:**
  - `analysisReady` abre la comida.
  - `wrappedReady` abre esa semana del Wrapped.
  - `streakRisk` abre el inicio.
  - Con datos inválidos no navega a una pantalla rota.
  - Tiene que funcionar con la app abierta y cerrada, y navegar una sola vez.
- **Android:** creá el canal `default` antes de pedir el permiso, porque Android 13+ lo exige.

## Fuera de alcance

No toques el envío de avisos del Backend. Si algo queda bloqueado o sin cubrir (por ejemplo, config de EAS), no lo resuelvas por tu cuenta: anotalo como pendiente en el PR.

## Tests y entrega

Cubrí cada criterio y estos casos:

- Permiso rechazado y bloqueado.
- Falla al obtener el token.
- Falla al guardar un interruptor.
- Toque con la app cerrada y abierta, sin doble navegación.
- Datos inválidos en el aviso.

Corré lint, typecheck, `format:check` y los tests de la app. Marcá en `docs/requerimientos.md` solo los ítems de RF-13 que queden hechos. Abrí el PR contra `main` con `Closes #39`, sin mergear.
