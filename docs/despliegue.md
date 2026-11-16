# Despliegue

Cada push a `main` con el CI en verde se despliega solo con [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml). El job corre en un **runner self-hosted instalado en el servidor**: el runner abre la conexión hacia GitHub, así que el SSH sigue cerrado a todo salvo las IPs del equipo.

También se puede lanzar a mano: **Actions → Deploy → Run workflow**.

## Qué hace el workflow

1. Hace checkout del commit exacto que pasó el CI.
2. Construye `front`, `back` y `worker` con `docker compose build --pull`.
3. Corre `docker compose up -d --remove-orphans` (proyecto `caloria`) y recrea nginx.
4. Espera hasta 60 s a que `GET http://localhost:8080/health` responda. Si falla, muestra `ps` y los logs, y el job queda en rojo.
5. Borra las imágenes sin uso.

Mongo, Redis y MinIO solo se recrean si cambia su imagen o su configuración; sus datos quedan en los volúmenes.

## Preparar el servidor (una sola vez)

Requisitos: Docker Engine con el plugin `compose`, `git` y `curl`.

### 1. Usuario del runner

```sh
sudo useradd -m -s /bin/bash github-runner
sudo usermod -aG docker github-runner
```

Pertenecer al grupo `docker` equivale a tener root en la máquina. Por eso este runner se usa solo para este repo y el workflow nunca corre en pull requests.

### 2. Secretos

Los secretos viven en el servidor, no en GitHub. Partí de [`infra/.env.example`](../infra/.env.example):

```sh
sudo mkdir -p /etc/caloria
sudo cp infra/.env.example /etc/caloria/caloria.env   # o pegá el contenido
sudo nano /etc/caloria/caloria.env                     # completar valores de producción
sudo chown root:github-runner /etc/caloria/caloria.env
sudo chmod 640 /etc/caloria/caloria.env
```

En producción, `S3_PUBLIC_ENDPOINT` tiene que ser el host público que alcanza la app.

### 3. Registrar el runner

En GitHub: **Settings → Actions → Runners → New self-hosted runner → Linux**. Copiá los comandos de descarga y el token que muestra esa pantalla (el token vence en una hora). Después, como `github-runner`:

```sh
sudo -iu github-runner
mkdir actions-runner && cd actions-runner
# curl -o actions-runner-linux-x64-<versión>.tar.gz -L <URL de la pantalla de GitHub>
tar xzf ./actions-runner-linux-x64-*.tar.gz
./config.sh --url https://github.com/BrunooRamos/caloria \
  --token <TOKEN> \
  --name caloria-prod \
  --labels caloria-prod \
  --unattended
exit
```

El label `caloria-prod` es el que pide `runs-on` en el workflow.

### 4. Dejarlo como servicio

```sh
cd /home/github-runner/actions-runner
sudo ./svc.sh install github-runner
sudo ./svc.sh start
sudo ./svc.sh status
```

El runner debería aparecer como **Idle** en **Settings → Actions → Runners**.

### 5. Proteger el repo (recomendado)

- **Settings → Actions → General → Fork pull request workflows from outside collaborators:** dejá *Require approval for all outside collaborators*.
- **Settings → Environments → production:** el workflow crea el environment en la primera corrida. Ahí se puede limitar a la rama `main` y, si se quiere, pedir aprobación manual antes de cada deploy.

## Primer despliegue

Con el runner en Idle, lanzá **Actions → Deploy → Run workflow** sobre `main`. Para ver el estado desde el servidor:

```sh
docker compose -p caloria ps
docker compose -p caloria logs -f back worker
```

## Costo

El repo es público, así que GitHub Actions no cobra minutos, ni con los runners de GitHub (CI) ni con el self-hosted (deploy).
