# tavi

tavi — short for Track And Visualize. We mostly just call it tavi.

## Local development

Tavi currently ships as a TypeScript monorepo with:

- `apps/web` - React workspace UI
- `apps/api` - NestJS API with local-auth support
- `apps/worker` - background worker for Loop import staging and commit jobs

### Run locally with Docker Compose

```bash
./scripts/up
```

Stop the stack with:

```bash
./scripts/down
```

The local stack exposes:

- web: `http://localhost:5173`
- api: `http://localhost:4000/api`
- api metrics: `http://localhost:4000/api/metrics`
- worker health: `http://localhost:4100/health`
- worker metrics: `http://localhost:4100/metrics`
- postgres: `localhost:5432`

Compose applies the committed Prisma migrations and seeds the local auth accounts automatically when the API container starts.

The local containers are named `tavi-postgres`, `tavi-api`, `tavi-web`, and `tavi-worker`.

If you need the header logo link to point somewhere other than the current local URL, set `TAVI_HOME_URL` before running `./scripts/up`. The Kubernetes web deployment reads the same `TAVI_HOME_URL` value from `infra/k8s/configmap.yaml`.

## Container publishing

GitHub Actions publishes the production image set from `infra/docker` to GHCR:

- `ghcr.io/mkronvold/tavi-api`
- `ghcr.io/mkronvold/tavi-web`
- `ghcr.io/mkronvold/tavi-worker`

The `publish-images.yml` workflow builds all three images on pull requests, then pushes branch, tag, and `sha-*` tags on `main`, version tags, or manual dispatch. The raw Kubernetes manifests currently consume the `latest` tag on the default branch.

### Local login accounts

- `admin@tavi.local`
- `editor@tavi.local`
- `viewer@tavi.local`

Password for all local accounts:

```text
password123
```

The login screen shows this default-user hint only while these seeded accounts
still exist with `password123`. Admins can recreate them from Settings -> Local
Accounts -> Reset Defaults.
