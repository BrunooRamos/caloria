# CalorIA

[![CI](https://github.com/BrunooRamos/caloria/actions/workflows/ci.yml/badge.svg)](https://github.com/BrunooRamos/caloria/actions/workflows/ci.yml)

App móvil con IA para registrar y analizar lo que comés (proyecto ING0265).

## Arquitectura

- **Capa 1 · Cliente** — app Expo / React Native: `app/`
- **Capa 2 · DMZ** — nginx + Front Service (BFF, :3000): `infra/nginx/`, `front-service/`
- **Capa 3 · Red segura** — Back Service (:4000), worker de IA, MongoDB y Redis: `back-service/`

Infraestructura en `infra/`, prompts de IA en `prompts/`, documentación en `docs/`.

## Levantar localmente

Los JWT se firman con RS256. Generá el par de claves una vez, fuera del repo, y pasalas a `infra/.env`:

```sh
npm run keys:generate                      # escribe ~/.caloria/jwt (o: npm run keys:generate -- <carpeta>)
cat ~/.caloria/jwt/jwt.env >> infra/.env   # JWT_PRIVATE_KEY (back) y JWT_PUBLIC_KEY (front)
docker compose -f infra/docker-compose.yml up
```

Sin su clave, cada servicio se niega a arrancar.

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
