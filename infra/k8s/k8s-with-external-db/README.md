# Kubernetes path: external database

Use this path when PostgreSQL already exists outside the cluster and Tavi only needs the app workloads.

## Deploys

| Component                     | Manifest                                                                           |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| Namespace                     | `namespace.yaml`                                                                   |
| ConfigMap                     | `configmap.yaml`                                                                   |
| Secret template               | `secret.example.yaml`                                                              |
| Backup storage                | `backup-pvc.yaml`                                                                  |
| Backup post-process templates | `backup-post-process-pvc.example.yaml`, `backup-post-process-cronjob.example.yaml` |
| API                           | `api-deployment.yaml`, `api-service.yaml`                                          |
| Web                           | `web-deployment.yaml`, `web-service.yaml`                                          |
| Worker                        | `worker-deployment.yaml`                                                           |
| Ingress                       | `ingress.yaml`                                                                     |

## Requirements

1. A reachable PostgreSQL database for `DATABASE_URL`.
2. A Kubernetes cluster with a compatible ingress controller.
3. The Tavi GHCR images available to the cluster.

## Configure

1. Edit `configmap.yaml` and `ingress.yaml` for your public hostname.
2. Update `backup-pvc.yaml` if your cluster needs a different storage class or size. The API and worker share this PVC, so the storage class must support `ReadWriteMany`.
3. Create a real secret from `secret.example.yaml` with your external `DATABASE_URL` and `COOKIE_SECRET`.
4. If you need downstream archival or off-cluster replication, customize `backup-post-process-pvc.example.yaml` and `backup-post-process-cronjob.example.yaml`.

## Install

```bash
kubectl apply -f infra/k8s/k8s-with-external-db/namespace.yaml
kubectl apply -f infra/k8s/k8s-with-external-db/configmap.yaml
kubectl apply -f infra/k8s/k8s-with-external-db/backup-pvc.yaml
kubectl apply -f infra/k8s/k8s-with-external-db/api-service.yaml
kubectl apply -f infra/k8s/k8s-with-external-db/web-service.yaml
kubectl apply -f infra/k8s/k8s-with-external-db/api-deployment.yaml
kubectl apply -f infra/k8s/k8s-with-external-db/worker-deployment.yaml
kubectl apply -f infra/k8s/k8s-with-external-db/web-deployment.yaml
kubectl apply -f infra/k8s/k8s-with-external-db/ingress.yaml
```

Apply the post-process templates only after customizing them:

```bash
kubectl apply -f infra/k8s/k8s-with-external-db/backup-post-process-pvc.example.yaml
kubectl apply -f infra/k8s/k8s-with-external-db/backup-post-process-cronjob.example.yaml
```

## Verify

```bash
kubectl rollout status deployment/tavi-api -n tavi
kubectl rollout status deployment/tavi-web -n tavi
kubectl rollout status deployment/tavi-worker -n tavi
```
