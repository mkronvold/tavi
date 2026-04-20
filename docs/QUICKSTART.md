# Quickstart

Use this page to choose the right way to run Tavi.

## Choose a path

1. Read [`BUILD.md`](./BUILD.md) if you are developing from the checked-out source tree and
   want Docker Compose to install dependencies and run the apps locally.
2. Read [`DOCKER.md`](./DOCKER.md) if you want a local runtime from the prebuilt GHCR images
   and do not want to build the product yourself.
3. Read [`KUBERNETES.md`](./KUBERNETES.md) if you want a cluster deployment with the raw manifests
   and the same GHCR images. The Kubernetes guide now breaks rollout into four
   manifest paths:
   - `infra/k8s/k8s-with-external-db/`
   - `infra/k8s/k8s-with-internal-db/`
   - `infra/k8s/k8s-with-replicas-and-external-db/`
   - `infra/k8s/k8s-with-replicas-and-internal-ha-db/`

## Which guide fits which job?

| Guide                              | Best for                                                                  | Builds locally? |
| ---------------------------------- | ------------------------------------------------------------------------- | --------------- |
| [`BUILD.md`](./BUILD.md)           | Day-to-day source development                                             | Yes             |
| [`DOCKER.md`](./DOCKER.md)         | Smoke tests, demos, and running published images locally                  | No              |
| [`KUBERNETES.md`](./KUBERNETES.md) | Choosing among the four Kubernetes deployment variants and operating them | No              |

All runtime guides now include backup-directory setup so automatic backups and restore have shared storage where they run.

## After startup

Once the app is running, the most useful feature guides are:

1. [`WORKSPACE.md`](./WORKSPACE.md) for daily project and task review.
2. [`SETTINGS.md`](./SETTINGS.md) for per-user synced preferences, account-specific settings, and admin controls.
3. [`IMPORT_EXPORT.md`](./IMPORT_EXPORT.md) for the settings-launched import/export panel.
4. [`BACKUPS.md`](./BACKUPS.md) for the settings-launched backup and restore panel.
5. [`NOTIFICATIONS.md`](./NOTIFICATIONS.md) for project/task update emails and daily digest behavior.

## Common endpoints

All three paths use the same app layout:

- Web UI
- API
- Worker
- PostgreSQL

The exact hostnames and ports depend on the guide you follow.
