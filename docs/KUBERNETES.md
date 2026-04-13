# Kubernetes Deployment Guide

This guide covers the checked-in raw manifests under `infra/k8s/` and the day-2 commands needed to operate them.

## What the manifests deploy

| Component | Manifest | Notes |
| --- | --- | --- |
| Namespace | `infra/k8s/namespace.yaml` | Creates the `tavi` namespace |
| Config | `infra/k8s/configmap.yaml` | App ports, public URLs, and CORS |
| Secret example | `infra/k8s/secret.example.yaml` | Template only; do not apply it unchanged |
| API deployment | `infra/k8s/api-deployment.yaml` | Runs Prisma migrations in an initContainer before the API starts |
| API service | `infra/k8s/api-service.yaml` | Exposes the API on service port `80` -> container port `4000` |
| Web deployment | `infra/k8s/web-deployment.yaml` | Serves the Vite-built web container on port `4173` |
| Web service | `infra/k8s/web-service.yaml` | Exposes the web app on service port `80` -> container port `4173` |
| Worker deployment | `infra/k8s/worker-deployment.yaml` | Background worker with `/health` and `/metrics` on port `4100` |
| Ingress | `infra/k8s/ingress.yaml` | Routes `/` to web and `/api` to API |

## Requirements

1. A Kubernetes cluster with ingress-nginx or a compatible controller using `ingressClassName: nginx`
2. `kubectl` access with permission to create resources in the `tavi` namespace
3. A reachable PostgreSQL database for `DATABASE_URL`
4. A strong `COOKIE_SECRET`
5. Access to the container images:
   - `ghcr.io/mkronvold/tavi-api`
   - `ghcr.io/mkronvold/tavi-web`
   - `ghcr.io/mkronvold/tavi-worker`

If your registry access is private, configure an image pull secret before rollout.

## Configure the deployment

### 1. Update public URLs

Edit `infra/k8s/configmap.yaml` and set:

1. `CORS_ORIGIN`
2. `TAVI_HOME_URL`
3. `VITE_API_BASE_URL`

Then update `infra/k8s/ingress.yaml` so the host matches the same public DNS name.

### 2. Create the application secret

Do not apply `infra/k8s/secret.example.yaml` unchanged. Create a real secret instead.

```bash
kubectl apply -f infra/k8s/namespace.yaml

kubectl -n tavi create secret generic tavi-secrets \
  --from-literal=DATABASE_URL='postgresql://username:password@postgres-host:5432/tavi?schema=public' \
  --from-literal=COOKIE_SECRET='replace-with-a-long-random-secret'
```

If the secret already exists, replace it safely:

```bash
kubectl -n tavi create secret generic tavi-secrets \
  --from-literal=DATABASE_URL='postgresql://username:password@postgres-host:5432/tavi?schema=public' \
  --from-literal=COOKIE_SECRET='replace-with-a-long-random-secret' \
  --dry-run=client -o yaml | kubectl apply -f -
```

### 3. Optional: pin image tags

The checked-in manifests use `latest`. For safer rollouts, replace those tags with a release tag before applying.

## Install

Apply the manifests except the example secret file:

```bash
kubectl apply -f infra/k8s/namespace.yaml
kubectl apply -f infra/k8s/configmap.yaml
kubectl apply -f infra/k8s/api-service.yaml
kubectl apply -f infra/k8s/web-service.yaml
kubectl apply -f infra/k8s/api-deployment.yaml
kubectl apply -f infra/k8s/worker-deployment.yaml
kubectl apply -f infra/k8s/web-deployment.yaml
kubectl apply -f infra/k8s/ingress.yaml
```

## Verify the rollout

```bash
kubectl get pods -n tavi
kubectl get svc -n tavi
kubectl get ingress -n tavi

kubectl rollout status deployment/tavi-api -n tavi
kubectl rollout status deployment/tavi-web -n tavi
kubectl rollout status deployment/tavi-worker -n tavi
```

What to expect:

1. The API deployment runs the `migrate` initContainer first.
2. The API pod becomes ready only after `/api/health` succeeds.
3. The worker pod becomes ready only after `/health` succeeds.
4. The ingress host serves the web app on `/` and proxies `/api` to the API service.

## Day-2 operations

### Check health and logs

```bash
kubectl get deploy,pods -n tavi
kubectl logs -n tavi deployment/tavi-api -c api --tail=200
kubectl logs -n tavi deployment/tavi-api -c migrate --tail=200
kubectl logs -n tavi deployment/tavi-web -c web --tail=200
kubectl logs -n tavi deployment/tavi-worker -c worker --tail=200
```

### Roll out a new image

```bash
kubectl -n tavi set image deployment/tavi-api api=ghcr.io/mkronvold/tavi-api:0.2.0
kubectl -n tavi set image deployment/tavi-web web=ghcr.io/mkronvold/tavi-web:0.2.0
kubectl -n tavi set image deployment/tavi-worker worker=ghcr.io/mkronvold/tavi-worker:0.2.0

kubectl rollout status deployment/tavi-api -n tavi
kubectl rollout status deployment/tavi-web -n tavi
kubectl rollout status deployment/tavi-worker -n tavi
```

### Restart without changing images

```bash
kubectl rollout restart deployment/tavi-api -n tavi
kubectl rollout restart deployment/tavi-web -n tavi
kubectl rollout restart deployment/tavi-worker -n tavi
```

### Roll back

```bash
kubectl rollout undo deployment/tavi-api -n tavi
kubectl rollout undo deployment/tavi-web -n tavi
kubectl rollout undo deployment/tavi-worker -n tavi
```

### Scale

```bash
kubectl scale deployment/tavi-api --replicas=2 -n tavi
kubectl scale deployment/tavi-web --replicas=2 -n tavi
kubectl scale deployment/tavi-worker --replicas=2 -n tavi
```

Scale the worker only when your queue throughput and database capacity can support it.

## Maintenance notes

1. API migrations run from the API deployment initContainer, so database compatibility should be checked before every image rollout.
2. Web config changes such as `TAVI_HOME_URL` or `VITE_API_BASE_URL` need a web rollout after the ConfigMap changes.
3. Secret changes for `DATABASE_URL` or `COOKIE_SECRET` require at least API and worker restarts.
4. The worker has no ClusterIP service because it is an internal background process.

## Troubleshooting

| Symptom | Likely cause | What to inspect |
| --- | --- | --- |
| API pod stuck in `Init` | Migration failure or bad database secret | `kubectl logs -n tavi deployment/tavi-api -c migrate --tail=200` |
| Web loads but API requests fail | `VITE_API_BASE_URL`, ingress, or `CORS_ORIGIN` mismatch | `infra/k8s/configmap.yaml`, `infra/k8s/ingress.yaml`, browser network tab |
| Imports never finish | Worker unavailable or cannot reach the database | `kubectl logs -n tavi deployment/tavi-worker -c worker --tail=200` |
| Ingress host does not respond | DNS or ingress-controller issue | `kubectl get ingress -n tavi`, ingress-controller logs |
| Metrics are missing | Prometheus scrape annotations not being collected | pod annotations on API and worker deployments |
