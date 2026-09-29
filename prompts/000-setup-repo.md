---
autor: Bruno Ramos (BrunooRamos)
version: 0.1
fecha: 2026-09-29
proposito: Crear desde cero el esqueleto del repositorio CalorIA.
---

# Tarea: crear desde cero el repositorio del proyecto CalorIA

Sos el encargado de crear el esqueleto del repositorio de un proyecto universitario (materia ING0265, app móvil con IA). Solo estructura y boilerplate MÍNIMO: nada de lógica de negocio todavía.

## Datos
- Nombre del repo: caloria
- Cuenta de GitHub: BrunooRamos
- Autor de este prompt: Bruno Ramos (BrunooRamos)
- Colaboradores: NO invites a nadie; los agrego yo después.

## Paso 0 — Verificaciones
1. Corré `gh auth status`. Si no estoy autenticado, FRENÁ y pedime que corra `gh auth login`. Si la cuenta logueada no es BrunooRamos, frená y avisame.
2. Verificá que existan `git`, `node` (v20 o superior) y `npm`. Si falta algo, avisame antes de seguir.

## Paso 1 — Crear el repo PRIVADO
- `gh repo create BrunooRamos/caloria --private --clone`
- Rama principal: `main`.

## Paso 2 — Arquitectura (contexto para que la estructura tenga sentido)
Tres capas:
- Capa 1 · Cliente: app Expo / React Native. Solo habla con nginx.
- Capa 2 · DMZ: nginx (TLS, rate limit) → Front Service (Express, :3000). El Front es un BFF: verifica JWT con clave PÚBLICA, valida con zod, compone respuestas y llama al Backend. NO tiene base de datos, ni claves de IA, ni clave privada.
- Capa 3 · Red segura: Back Service (Express, :4000) con la lógica, MongoDB, Redis (cola) y un worker de IA. Firma los JWT con RS256 (clave privada).
- Único cruce entre zonas: Front → Back por HTTPS :4000 (mTLS en producción).

## Paso 3 — Estructura exacta
Git no guarda carpetas vacías: cada carpeta sin código lleva un `README.md` de 1 a 3 líneas que diga qué va ahí y a qué capa pertenece.

```
caloria/
├── README.md
├── .gitignore
├── app/                    # Capa 1 · Cliente
├── front-service/          # Capa 2 · DMZ · :3000
│   ├── src/
│   │   ├── index.ts
│   │   ├── routes/  controllers/  middleware/  schemas/  clients/  config/
│   ├── package.json · tsconfig.json · .env.example · Dockerfile
├── back-service/           # Capa 3 · Red segura · :4000
│   ├── src/
│   │   ├── index.ts
│   │   ├── worker.ts
│   │   ├── routes/  controllers/  services/  middleware/  models/  jobs/  config/
│   ├── package.json · tsconfig.json · .env.example · Dockerfile
├── prompts/
│   ├── 000-setup-repo.md
│   ├── analisis-comida.md
│   ├── roast.md
│   └── wrapped.md
├── infra/
│   ├── docker-compose.yml
│   ├── nginx/nginx.conf
│   └── certs/README.md
└── docs/
    ├── PLAN.md
    └── RFC.md
```

## Paso 4 — Contenido MÍNIMO de cada parte

**app/**
- `npx create-expo-app@latest app --template blank-typescript`.
- Dentro, creá las carpetas vacías `components/`, `features/`, `services/`, `store/`, cada una con un README de una línea. No agregues librerías.
- Si create-expo-app falla, dejá solo las carpetas con sus README y avisame.

**front-service/** y **back-service/** (misma base, TypeScript):
- `package.json` solo con: `express` (dependencia), y `typescript`, `tsx`, `@types/express`, `@types/node` (dev). Scripts: `dev` (tsx watch src/index.ts), `build` (tsc), `start` (node dist/index.js).
- `src/index.ts`: un servidor Express que responde `GET /health` → `{ "status": "ok", "service": "front" }` (o `"back"`), en el puerto de `process.env.PORT` (por defecto 3000 en el front y 4000 en el back). Nada más.
- En back-service, `src/worker.ts`: solo un `console.log("worker listo")`, con un comentario que diga que acá se consumirá la cola de Redis.
- `.env.example` con los nombres de las variables SIN valores:
  - front: `PORT`, `BACKEND_URL`, `JWT_PUBLIC_KEY_PATH`
  - back: `PORT`, `MONGO_URI`, `REDIS_URL`, `JWT_PRIVATE_KEY_PATH`, `JWT_PUBLIC_KEY_PATH`, `AI_API_KEY`
- `Dockerfile` mínimo: node:20-alpine, instalar, compilar, correr.
- Cada subcarpeta de `src/` lleva un README de una línea. En el front, el README de la raíz del servicio aclara que NO tiene models/ ni jobs/ a propósito.

**prompts/**
- Cada archivo empieza con este encabezado y un cuerpo "Pendiente":
```
  ---
  autor: Bruno Ramos (BrunooRamos)
  version: 0.1
  fecha: <fecha de hoy>
  proposito: <una línea>
  ---
```
- En `000-setup-repo.md`, guardá el TEXTO COMPLETO de este prompt, con el encabezado. Es requisito del curso que todos los prompts usados queden en esta carpeta con su autor.

**infra/**
- `docker-compose.yml` con dos redes: `dmz` e `interna` (esta última con `internal: true`). Servicios:
  - `nginx`: red `dmz`; es el ÚNICO que publica puertos (`8080:80` para desarrollo local).
  - `front`: redes `dmz` e `interna`.
  - `back` y `worker` (misma imagen, `command` distinto): red `interna`.
  - `mongo` y `redis`: red `interna`, sin puertos publicados.
  - Comentario arriba del archivo: "Mongo y Redis nunca están en la red dmz".
- `nginx/nginx.conf`: un proxy mínimo de `/` hacia `http://front:3000`, con un comentario que diga que en producción se agrega TLS en el 443.
- `certs/README.md`: explica que acá se generará la CA interna y los certificados mTLS, y que los certificados NO se suben al repo.

**docs/**
- `PLAN.md` con estos títulos vacíos: Metodología · Roles · Avance por clase (tabla: Fecha | Avance esperado | Responsable) · Riesgos.
- `RFC.md` con el título y "Pendiente".

**Raíz**
- `README.md`: una línea de descripción, la lista de las tres capas y qué carpeta corresponde a cada una, y cómo levantar localmente (`docker compose -f infra/docker-compose.yml up`).
- `.gitignore`: `node_modules/`, `dist/`, `.env`, `.env.*` (excepto `.env.example`), `infra/certs/*` (excepto `README.md`), `.expo/`, `.DS_Store`.

## Paso 5 — Verificar
- En front-service y back-service: `npm install` y `npm run build`. Tienen que compilar sin errores.
- Confirmá que no se sube ningún `.env`, `node_modules` ni certificado (`git status`).

## Paso 6 — Commit y push
- Un único commit: `chore: esqueleto inicial del proyecto`, y push a `main`.

## Reglas
- MÍNIMO: no agregues dependencias, lint, tests, CI ni lógica que no esté pedida acá.
- No inventes contenido de negocio. Donde falte, escribí "Pendiente".
- Si algo falla, no improvises alternativas grandes: frená y contame qué pasó.

## Al terminar, mostrame
1. La URL del repo.
2. El árbol final (`tree -a -I 'node_modules|.git|.expo' -L 3`, o equivalente).
