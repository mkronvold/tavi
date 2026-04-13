# Quickstart

Use this page to choose the right way to run Tavi.

## Choose a path

1. Read `BUILD.md` if you are developing from the checked-out source tree and
   want Docker Compose to install dependencies and run the apps locally.
2. Read `DOCKER.md` if you want a local runtime from the prebuilt GHCR images
   and do not want to build the product yourself.
3. Read `KUBERNETES.md` if you want a cluster deployment with the raw manifests
   and the same GHCR images.

## Which guide fits which job?

| Guide | Best for | Builds locally? |
| --- | --- | --- |
| `BUILD.md` | Day-to-day source development | Yes |
| `DOCKER.md` | Smoke tests, demos, and running published images locally | No |
| `KUBERNETES.md` | Resilient environment deployment and operations | No |

## Common endpoints

All three paths use the same app layout:

- Web UI
- API
- Worker
- PostgreSQL

The exact hostnames and ports depend on the guide you follow.
