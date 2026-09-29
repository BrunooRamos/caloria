# CalorIA

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
