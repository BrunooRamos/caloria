# CalorIA

[![CI](https://github.com/BrunooRamos/caloria/actions/workflows/ci.yml/badge.svg)](https://github.com/BrunooRamos/caloria/actions/workflows/ci.yml)

App móvil con IA para registrar y analizar lo que comés (proyecto ING0265).

## Arquitectura

- **Capa 1 · Cliente** — app Expo / React Native: `app/`
- **Capa 2 · DMZ** — nginx + Front Service (BFF, :3000): `infra/nginx/`, `front-service/`
- **Capa 3 · Red segura** — Back Service (:4000), worker de IA, MongoDB y Redis: `back-service/`

Infraestructura en `infra/`, prompts de IA en `prompts/`, documentación en `docs/`.

## Levantar localmente

```sh
docker compose -f infra/docker-compose.yml up
```

Queda disponible en http://localhost:8080 (por ejemplo `/health`).

## Calidad de código

ESLint, Prettier y TypeScript (`strict`) comparten configuración desde la raíz (`eslint.config.mjs`, `.prettierrc.json`). Las herramientas se instalan una sola vez en la raíz:

```sh
npm install            # en la raíz
npm run lint           # ESLint sobre todo el repo
npm run typecheck      # tsc --noEmit en app, front-service y back-service
npm run format         # Prettier (format:check para verificar sin escribir)
```

Cada paquete también tiene sus propios `lint`, `typecheck`, `format` y `format:check` (requieren haber instalado la raíz y el paquete).
