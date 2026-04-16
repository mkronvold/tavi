# Docker Runtime Guide

Use this guide to run Tavi locally from the published GHCR images. This path
does not build the product locally and does not mount your working tree into
the containers. If you want source-driven local development, use `BUILD.md`
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

## Pick an image tag

Use a release tag when possible. `latest` is fine for the current default
branch.

```bash
export TAVI_TAG=latest
export TAVI_COOKIE_SECRET='replace-with-a-long-random-secret'
export TAVI_DATABASE_URL='postgresql://tavi:tavi@tavi-postgres:5432/tavi?schema=public'
export TAVI_BACKUP_DIRECTORY='/var/tavi/backups'
```

The API and worker must use the same backup directory so stored backups, backup-now, download, delete, and restore all operate on the same files.

## Pull the published images

```bash
docker pull postgres:16-alpine
docker pull ghcr.io/mkronvold/tavi-api:${TAVI_TAG}
docker pull ghcr.io/mkronvold/tavi-web:${TAVI_TAG}
docker pull ghcr.io/mkronvold/tavi-worker:${TAVI_TAG}
```

## Create local Docker state

```bash
docker network inspect tavi-net >/dev/null 2>&1 || docker network create tavi-net
docker volume inspect tavi-postgres-data >/dev/null 2>&1 || docker volume create tavi-postgres-data
mkdir -p ./backups
```

Run these once per machine, or rerun them safely if the network and volume
already exist.

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

If you skipped seeding, use whatever accounts already exist in your database.

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

See `BACKUPS.md` for the UI workflow once the containers are running.
