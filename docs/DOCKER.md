# Docker Runtime Guide

Use this guide to run Tavi locally from the published GHCR images. This path
does not build the product locally and does not mount your working tree into
the containers. If you want source-driven local development, use [`BUILD.md`](./BUILD.md)
instead.

## Requirements

1. Docker Engine
2. Access to these images:
   - `ghcr.io/mkronvold/tavi-api`
   - `ghcr.io/mkronvold/tavi-web`
   - `ghcr.io/mkronvold/tavi-worker`
3. Free local ports `5173`, `4000`, `4100`, and `5432`

If your GHCR access is private in your environment, run `docker login ghcr.io`
before pulling images.

## Configure environment variables

The published-image compose stack reads its configuration from shell variables or
from a file passed with `--env-file`. Use an explicit env file so the path is
unambiguous:

```bash
cp infra/docker/compose-prod.env.example infra/docker/compose-prod.env
```

Edit `infra/docker/compose-prod.env` and set a real `TAVI_COOKIE_SECRET` and
`POSTGRES_PASSWORD` before the first start.

Important variables:

| Variable                                                                                       | What it controls                                                                                          | Default in the example              |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `TAVI_TAG`                                                                                     | GHCR image tag for API, web, and worker                                                                   | `latest`                            |
| `TAVI_COOKIE_SECRET`                                                                           | Required API session secret                                                                               | `replace-with-a-long-random-secret` |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`                                            | Internal Postgres container credentials                                                                   | `tavi`, `tavi`, `replace-me`        |
| `TAVI_DATABASE_URL`                                                                            | Optional override for API/worker DB connection                                                            | unset                               |
| `TAVI_WEB_HOST_PORT`, `TAVI_API_HOST_PORT`, `TAVI_WORKER_HOST_PORT`, `TAVI_POSTGRES_HOST_PORT` | Host ports published by the compose stack                                                                 | `5173`, `4000`, `4100`, `5432`      |
| `TAVI_HOME_URL`                                                                                | Header home link and web runtime app URL                                                                  | `http://localhost:5173`             |
| `TAVI_API_BASE_URL`                                                                            | Browser-facing API base URL used by the web container                                                     | `http://localhost:4000/api`         |
| `TAVI_CORS_ORIGIN`                                                                             | Allowed browser origin for the API                                                                        | `http://localhost:5173`             |
| `TAVI_BACKUP_DIRECTORY`                                                                        | Shared backup path inside API and worker containers                                                       | `/var/tavi/backups`                 |
| `SMTP_URL`, `SMTP_FROM`                                                                        | Optional outbound email settings (`SMTP_URL` includes protocol, host, port, and any required credentials) | example/local defaults              |

Notes:

1. If `TAVI_DATABASE_URL` is unset, the API and worker connect to the bundled
   `postgres` service using `POSTGRES_*`.
2. The API and worker must use the same `TAVI_BACKUP_DIRECTORY` so stored
   backups, backup-now, download, delete, and restore all operate on the same
   files.
3. If you want a different env file name or location, keep the compose file as
   is and pass that path with `--env-file`. You do not need to edit the compose
   YAML just to use a custom env file.
4. Put the full SMTP connection string in `SMTP_URL`, for example
   `smtp://username:password@smtp.office365.com:587` or
   `smtps://username:password@smtp.example.com:465`.
5. `POSTGRES_PASSWORD` is required for the bundled Postgres service. Changing
   it in the env file after Postgres has already initialized its data volume
   does not rotate the existing database user's password; either update the role
   in Postgres or recreate the Postgres volume for a fresh database.

## Recommended quick start with Docker Compose

The repository now includes a published-image compose stack at
`infra/docker/compose-prod.yaml`. It uses the GHCR images, does not mount the
working tree into the containers, runs the web image in its default static
production mode, and uses a one-shot migration service before the long-running
app containers start.

Then start the stack:

```bash
docker compose \
  --env-file infra/docker/compose-prod.env \
  -f infra/docker/compose-prod.yaml \
  up -d
```

Follow the API logs to catch the generated initial admin password if the
database starts empty:

```bash
docker compose \
  --env-file infra/docker/compose-prod.env \
  -f infra/docker/compose-prod.yaml \
  logs -f api
```

Stop the stack with:

```bash
docker compose \
  --env-file infra/docker/compose-prod.env \
  -f infra/docker/compose-prod.yaml \
  down
```

This compose path creates named Docker volumes for PostgreSQL data and backups
automatically, so no manual network or volume bootstrap is required.

If you want to keep multiple environment files, point Compose at the one you
want for that run:

```bash
docker compose \
  --env-file ./ops/tavi-prod.env \
  -f infra/docker/compose-prod.yaml \
  up -d
```

## Pull the published images

```bash
set -a
. ./infra/docker/compose-prod.env
set +a

docker pull postgres:16-alpine
docker pull ghcr.io/mkronvold/tavi-api:${TAVI_TAG}
docker pull ghcr.io/mkronvold/tavi-web:${TAVI_TAG}
docker pull ghcr.io/mkronvold/tavi-worker:${TAVI_TAG}
```

The `latest` tag is refreshed by the scheduled container lifecycle workflow. To
pick up a refreshed `latest` image in the compose runtime, pull and restart the
stack:

```bash
docker compose \
  --env-file infra/docker/compose-prod.env \
  -f infra/docker/compose-prod.yaml \
  pull

docker compose \
  --env-file infra/docker/compose-prod.env \
  -f infra/docker/compose-prod.yaml \
  up -d
```

If you want to pin a specific refreshed build, set `TAVI_TAG` to the
`refresh-YYYYMMDD-HHMMSS` tag documented in [`LCM.md`](./LCM.md), then run the
same pull and up commands.

## Create local Docker state

If you prefer to manage each container manually instead of using the checked-in
compose file, use the commands below.

```bash
docker network inspect tavi-net >/dev/null 2>&1 || docker network create tavi-net
docker volume inspect tavi-postgres-data >/dev/null 2>&1 || docker volume create tavi-postgres-data
mkdir -p ./backups
```

Run these once per machine, or rerun them safely if the network and volume
already exist.

The manual `docker run` commands below assume you already exported the same
variables into your shell, for example:

```bash
set -a
. ./infra/docker/compose-prod.env
set +a
```

## Start PostgreSQL

```bash
docker run -d \
  --name tavi-postgres \
  --network tavi-net \
  -e POSTGRES_DB=tavi \
  -e POSTGRES_USER=tavi \
  -e POSTGRES_PASSWORD=tavi \
  -p 5432:5432 \
  -v tavi-postgres-data:/var/lib/postgresql/data \
  --health-cmd="pg_isready -U tavi -d tavi" \
  --health-interval=2s \
  --health-timeout=3s \
  --health-retries=30 \
  postgres:16-alpine
```

Wait for the database to become healthy:

```bash
until [ "$(docker inspect -f '{{.State.Health.Status}}' tavi-postgres)" = "healthy" ]; do
  sleep 2
done
```

## Apply migrations and seed local accounts

Run the checked-in Prisma migrations with the published API image:

```bash
docker run --rm \
  --name tavi-migrate \
  --network tavi-net \
  -e DATABASE_URL="${TAVI_DATABASE_URL}" \
  -e COOKIE_SECRET="${TAVI_COOKIE_SECRET}" \
  -e CORS_ORIGIN="http://localhost:5173" \
  -e PORT=4000 \
  ghcr.io/mkronvold/tavi-api:${TAVI_TAG} \
  pnpm --filter @tavi/api prisma:migrate
```

Seed the standard local accounts if you want the usual demo and admin login set:

```bash
docker run --rm \
  --name tavi-seed \
  --network tavi-net \
  -e DATABASE_URL="${TAVI_DATABASE_URL}" \
  -e COOKIE_SECRET="${TAVI_COOKIE_SECRET}" \
  -e CORS_ORIGIN="http://localhost:5173" \
  -e PORT=4000 \
  ghcr.io/mkronvold/tavi-api:${TAVI_TAG} \
  pnpm --filter @tavi/api prisma:seed
```

If you skip manual seeding and start the API in local-auth mode against an empty database, the API now auto-creates only `admin@tavi.local`, generates a random 10-character alphanumeric password, and writes that initial password to the API logs on first startup.

To find that generated password in the compose-based production runtime:

```bash
docker compose \
  --env-file infra/docker/compose-prod.env \
  -f infra/docker/compose-prod.yaml \
  logs api \
  | rg 'auth.bootstrap.initial_admin_created|initialPassword'
```

## Start the app containers

API:

```bash
docker run -d \
  --name tavi-api \
  --network tavi-net \
  -e DATABASE_URL="${TAVI_DATABASE_URL}" \
  -e BACKUP_DIRECTORY="${TAVI_BACKUP_DIRECTORY}" \
  -e COOKIE_SECRET="${TAVI_COOKIE_SECRET}" \
  -e CORS_ORIGIN="http://localhost:5173" \
  -e PORT=4000 \
  -v "$(pwd)/backups:${TAVI_BACKUP_DIRECTORY}" \
  -p 4000:4000 \
  ghcr.io/mkronvold/tavi-api:${TAVI_TAG}
```

Worker:

```bash
docker run -d \
  --name tavi-worker \
  --network tavi-net \
  -e DATABASE_URL="${TAVI_DATABASE_URL}" \
  -e BACKUP_DIRECTORY="${TAVI_BACKUP_DIRECTORY}" \
  -e PORT=4100 \
  -v "$(pwd)/backups:${TAVI_BACKUP_DIRECTORY}" \
  -p 4100:4100 \
  ghcr.io/mkronvold/tavi-worker:${TAVI_TAG}
```

Web:

```bash
docker run -d \
  --name tavi-web \
  --network tavi-net \
  -e VITE_API_BASE_URL="http://localhost:4000/api" \
  -e TAVI_HOME_URL="http://localhost:5173" \
  -p 5173:4173 \
  ghcr.io/mkronvold/tavi-web:${TAVI_TAG}
```

The web image now defaults to the production static server. If you explicitly want Vite preview instead, override the container command at run time:

```bash
docker run -d \
  --name tavi-web-preview \
  --network tavi-net \
  -e VITE_API_BASE_URL="http://localhost:4000/api" \
  -e TAVI_HOME_URL="http://localhost:5173" \
  -p 5173:4173 \
  ghcr.io/mkronvold/tavi-web:${TAVI_TAG} start:preview
```

## Open the app

After the containers are up, open:

- Web UI: `http://localhost:5173`
- API: `http://localhost:4000/api`
- API metrics: `http://localhost:4000/api/metrics`
- Worker health: `http://localhost:4100/health`
- Worker metrics: `http://localhost:4100/metrics`

## Sign in

If you ran the seed step above, use these local accounts:

| Role   | Email               | Password      |
| ------ | ------------------- | ------------- |
| Admin  | `admin@tavi.local`  | `password123` |
| Editor | `editor@tavi.local` | `password123` |
| Viewer | `viewer@tavi.local` | `password123` |

If you skipped seeding and the database started empty, check the API logs for the
generated initial `admin@tavi.local` password. Otherwise, use whatever accounts
already exist in your database.

## Useful commands

Check container state:

```bash
docker ps --filter name=tavi-
```

Follow logs:

```bash
docker logs -f tavi-api
docker logs -f tavi-web
docker logs -f tavi-worker
docker logs -f tavi-postgres
```

## Stop the stack

```bash
docker stop tavi-web tavi-worker tavi-api tavi-postgres
docker rm tavi-web tavi-worker tavi-api tavi-postgres
```

## Reset local Docker data

This removes the local PostgreSQL data volume and is destructive for your local
environment.

```bash
docker stop tavi-web tavi-worker tavi-api tavi-postgres
docker rm tavi-web tavi-worker tavi-api tavi-postgres
docker volume rm tavi-postgres-data
```

## Local troubleshooting

| Problem                           | What to check                                                                                                  |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Web UI does not load              | Confirm `tavi-web` is running and port `5173` is free                                                          |
| API calls fail                    | Confirm `tavi-api` is running, `CORS_ORIGIN` matches `http://localhost:5173`, and port `4000` is free          |
| Imports do not progress           | Confirm `tavi-worker` is running                                                                               |
| Login fails with default accounts | Re-run the seed step or use the current local accounts in the database                                         |
| Database never becomes healthy    | Confirm `tavi-postgres` started cleanly and no other service is using local port `5432`                        |
| Automatic backups do not show up  | Confirm both API and worker mount the same host `./backups` directory and use the same `BACKUP_DIRECTORY` path |

See [`BACKUPS.md`](./BACKUPS.md) for the UI workflow once the containers are running.
