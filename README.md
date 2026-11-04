# CalorIA

[![CI](https://github.com/BrunooRamos/caloria/actions/workflows/ci.yml/badge.svg)](https://github.com/BrunooRamos/caloria/actions/workflows/ci.yml)

App móvil con IA para registrar y analizar lo que comés (proyecto ING0265).

## Arquitectura

- **Capa 1 · Cliente** — app Expo / React Native: `app/`
- **Capa 2 · DMZ** — nginx + Front Service (BFF, :3000): `infra/nginx/`, `front-service/`
- **Capa 3 · Red segura** — Back Service (:4000), worker de IA, MongoDB, Redis y MinIO (media): `back-service/`

Infraestructura en `infra/`, prompts del repo en `prompts/` (los de la app, en `back-service/src/prompts/`), documentación en `docs/`.

## Levantar localmente

Los JWT se firman con RS256. Generá el par de claves una vez, fuera del repo, y pasalas a `infra/.env`:

```sh
npm run keys:generate                      # escribe ~/.caloria/jwt (o: npm run keys:generate -- <carpeta>)
cat ~/.caloria/jwt/jwt.env >> infra/.env   # JWT_PRIVATE_KEY (back) y JWT_PUBLIC_KEY (front)
```

La media (fotos y audios) va a un bucket privado de MinIO. Completá en `infra/.env` las credenciales root y las del usuario de servicio que usan Back y Worker (ver `infra/.env.example`). En dev, el override publica MinIO en `127.0.0.1:9000` para que la app abra las URLs firmadas, y la consola web en http://localhost:9001 (login con las credenciales root):

```sh
docker compose -f infra/docker-compose.yml -f infra/docker-compose.dev.yml up
```

Sin su clave o sin la config de storage, cada servicio se niega a arrancar. Sin `DOMAIN`, nginx tampoco arranca: en local, `DOMAIN=localhost` (ya viene así en `infra/.env.example`).

En dev, la API queda en http://localhost:8080 (por ejemplo `/health`), que es lo que usan Expo Go y los builds de desarrollo. También queda https://localhost con un certificado autofirmado temporal (`curl -k`). El 80 solo redirige a HTTPS.

## HTTPS

Todo el tráfico de la app va cifrado (RNF-03). nginx es lo único que publica puertos: el 443, y el 80, que solo sirve el desafío de Let's Encrypt (`/.well-known/acme-challenge/`) y redirige todo lo demás a HTTPS con la misma ruta y query. Cómo funciona por dentro: [docs/arquitectura.md](docs/arquitectura.md#https-y-certificados).

### En el servidor, con dominio

1. Un registro DNS A (y AAAA, si hay IPv6) del dominio a la IP del servidor, y el 80 y el 443 abiertos desde Internet.
2. En `infra/.env`:

   ```sh
   DOMAIN=api.caloria.app
   COMPOSE_PROFILES=letsencrypt
   LETSENCRYPT_EMAIL=equipo@caloria.app
   LETSENCRYPT_STAGING=1
   HSTS_MAX_AGE=300
   ```

3. `docker compose -f infra/docker-compose.yml up -d`, sin pasos previos. nginx arranca con un certificado temporal y certbot pide el de Let's Encrypt: en un minuto, nginx lo sirve solo. Para seguirlo, `docker compose -f infra/docker-compose.yml logs -f certbot nginx`.
4. Con staging, el certificado que llega no es de confianza para ningún cliente (`curl` sin `-k` lo rechaza); sirve para probar el circuito sin gastar los [límites de producción](https://letsencrypt.org/docs/rate-limits/). Cuando ande, pasá a `LETSENCRYPT_STAGING=0` y volvé a correr el `up -d`: certbot detecta el cambio y pide el certificado real.

Para verificar RNF-03, desde otra máquina y ya con el certificado de producción:

```sh
curl -sI "http://api.caloria.app/api/v1/meals?from=2026-10-01"  # 301 a https://api.caloria.app/... con la misma ruta y query
curl -sI https://api.caloria.app/health                         # 200 sin -k, con Strict-Transport-Security
curl -m 5 http://api.caloria.app:3000/ ; curl -m 5 http://api.caloria.app:4000/  # fallan: Front y Backend no publican puertos
```

Y en el servidor, una renovación de prueba contra staging (sin terminal, como en un script, sumá `--no-random-sleep-on-renew`: si no, certbot espera hasta 8 minutos al azar):

```sh
docker compose -f infra/docker-compose.yml exec certbot certbot renew --dry-run
```

### Renovación

Es automática. certbot corre `certbot renew` cada 12 h y renueva cuando falta poco para que venza. nginx revisa cada minuto si el certificado cambió y, si cambió, recarga en caliente (`nginx -s reload`): no se reinicia ni corta conexiones. Los certificados y las claves viven en el volumen `letsencrypt`, nunca en el repo. Let's Encrypt ya no manda mails antes del vencimiento, así que conviene mirar de vez en cuando `docker compose -f infra/docker-compose.yml logs certbot` y el vencimiento del certificado (`echo | openssl s_client -connect api.caloria.app:443 2>/dev/null | openssl x509 -noout -enddate`).

**HSTS:** arranca con `max-age=300` (5 minutos), sin `includeSubDomains` ni `preload`. Un navegador que lo recibe se niega a entrar por HTTP durante todo ese tiempo, así que se sube de a poco cuando HTTPS ande bien: `86400` (un día), después `604800` (una semana) y recién al final `31536000` (un año). Cada cambio es editar `HSTS_MAX_AGE` y hacer `up -d nginx`. `preload` no se agrega sin decidirlo: sacar un dominio de la lista de los navegadores lleva meses.

### Sin dominio

| Opción                                                     | Cuándo conviene                                                                      | A favor                                                           | En contra                                                                                                                                                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Quick tunnel de Cloudflare** (`COMPOSE_PROFILES=tunnel`) | Probar la app contra el servidor desde cualquier red, o una demo corta con Expo Go   | HTTPS válido sin cuenta ni dominio; la app funciona tal como está | La URL cambia en cada arranque; máximo 200 requests en vuelo y sin SLA                                                                                                                     |
| **ngrok** con el dominio gratis de la cuenta               | La demo con un build instalado, porque la URL queda embebida en el build y no cambia | HTTPS válido con un dominio fijo (`<nombre>.ngrok-free.app`)      | Requiere cuenta; el plan gratis tiene 20.000 requests y 1 GB por mes; la misma IP compartida para el rate limit                                                                            |
| **Autofirmado o mkcert**                                   | Probar nginx (TLS, redirecciones, límites) o desarrollar en local                    | Sin Internet ni terceros                                          | iOS y Android lo rechazan si no se instala la CA en el dispositivo, y los builds de release de Android no confían en las CA que instala el usuario: **no sirve para la app tal como está** |

En los tres casos la media (las URLs firmadas de MinIO) no pasa por el túnel: la app solo las abre si MinIO le queda accesible, como en la red local con Expo Go.

**Cloudflare:** con `COMPOSE_PROFILES=tunnel` en `infra/.env` (y `DOMAIN=localhost`), `docker compose -f infra/docker-compose.yml up -d` levanta también `cloudflared`, que entra por el 8443 de nginx (un listener que no se publica en el host y toma la IP del cliente de `CF-Connecting-IP`, para que el rate limit de `/auth` sea por cliente) verificando el certificado temporal. La URL sale en los logs y va, con `/api/v1`, en `EXPO_PUBLIC_API_URL` de la app:

```sh
docker compose -f infra/docker-compose.yml logs tunnel | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com'
```

**ngrok:** con una cuenta y su authtoken, desde el host:

```sh
ngrok config add-authtoken <token>
ngrok http https://localhost:443   # usa el dominio fijo de la cuenta; ngrok no verifica el certificado temporal
```

**Autofirmado:** es el certificado temporal que nginx ya usa sin Let's Encrypt (`curl -k https://localhost/health`). Con [mkcert](https://github.com/FiloSottile/mkcert) se evita el `-k` en tu máquina: genera una CA local de confianza y un certificado que nginx toma de `infra/certs/local/`.

```sh
mkcert -install
mkdir -p infra/certs/local
mkcert -cert-file infra/certs/local/fullchain.pem -key-file infra/certs/local/privkey.pem localhost 127.0.0.1
```

Para usarlo desde el simulador o un teléfono habría que instalar la CA de mkcert (`mkcert -CAROOT`) en cada dispositivo y, en Android, además permitir CA de usuario en la app; por eso, para la app, el túnel.

## Calidad de código

ESLint, Prettier y TypeScript (`strict`) comparten configuración desde la raíz (`eslint.config.mjs`, `.prettierrc.json`). Las herramientas se instalan una sola vez en la raíz:

```sh
npm install            # en la raíz
npm run lint           # ESLint sobre todo el repo
npm run typecheck      # tsc --noEmit en app, front-service y back-service
npm run format         # Prettier (format:check para verificar sin escribir)
```

La config de nginx se prueba con Docker, igual que en CI: `nginx -t`, la redirección del 80, el desafío de Let's Encrypt, TLS 1.2/1.3 y HSTS, el cambio de certificado sin reiniciar y los límites de `POST /meals`:

```sh
npm run nginx:smoke
```

Cada paquete también tiene sus propios `lint`, `typecheck`, `format` y `format:check` (requieren haber instalado la raíz y el paquete).
