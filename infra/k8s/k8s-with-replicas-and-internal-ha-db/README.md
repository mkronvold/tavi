# Kubernetes path: replicas with internal HA database

Use this path when the cluster should run the app at three replicas and PostgreSQL should be managed in-cluster as a three-instance CloudNativePG cluster.

## Deploys

| Component                     | Manifest                                                                           |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| Namespace                     | `namespace.yaml`                                                                   |
| ConfigMap                     | `configmap.yaml`                                                                   |
| Secret template               | `secret.example.yaml`                                                              |
| Backup storage                | `backup-pvc.yaml`                                                                  |
| Backup post-process templates | `backup-post-process-pvc.example.yaml`, `backup-post-process-cronjob.example.yaml` |
| CloudNativePG cluster         | `postgres-cluster.yaml`                                                            |
| API (3 replicas)              | `api-deployment.yaml`, `api-service.yaml`                                          |
| Web (3 replicas)              | `web-deployment.yaml`, `web-service.yaml`                                          |
| Worker (3 replicas)           | `worker-deployment.yaml`                                                           |
| Ingress                       | `ingress.yaml`                                                                     |

## Requirements

1. The CloudNativePG operator and CRDs already installed in the cluster.
2. A Kubernetes storage class suitable for CloudNativePG volumes.
3. A compatible ingress controller.
4. Capacity for three API pods, three web pods, three worker pods, and a three-instance PostgreSQL cluster.

## Configure

1. Edit `configmap.yaml` and `ingress.yaml` for your public hostname.
2. Create the three real secrets from `secret.example.yaml`:
   - `tavi-secrets`
   - `tavi-postgres-app`
   - `tavi-postgres-superuser`
3. Keep `DATABASE_URL` pointed at the CloudNativePG read-write service `tavi-postgres-rw`.
4. Adjust the storage size in `postgres-cluster.yaml` if `10Gi` is not appropriate.
5. Update `backup-pvc.yaml` if your cluster needs a different storage class or size. The API and worker share this PVC across replica sets, so the storage class must support `ReadWriteMany`.
6. If you need downstream archival or off-cluster replication, customize `backup-post-process-pvc.example.yaml` and `backup-post-process-cronjob.example.yaml`.

## Install

```bash
kubectl apply -f infra/k8s/k8s-with-replicas-and-internal-ha-db/namespace.yaml
kubectl apply -f infra/k8s/k8s-with-replicas-and-internal-ha-db/configmap.yaml
kubectl apply -f infra/k8s/k8s-with-replicas-and-internal-ha-db/backup-pvc.yaml
kubectl apply -f infra/k8s/k8s-with-replicas-and-internal-ha-db/postgres-cluster.yaml
kubectl apply -f infra/k8s/k8s-with-replicas-and-internal-ha-db/api-service.yaml
kubectl apply -f infra/k8s/k8s-with-replicas-and-internal-ha-db/web-service.yaml
kubectl apply -f infra/k8s/k8s-with-replicas-and-internal-ha-db/api-deployment.yaml
kubectl apply -f infra/k8s/k8s-with-replicas-and-internal-ha-db/worker-deployment.yaml
kubectl apply -f infra/k8s/k8s-with-replicas-and-internal-ha-db/web-deployment.yaml
kubectl apply -f infra/k8s/k8s-with-replicas-and-internal-ha-db/ingress.yaml
```

Apply the post-process templates only after customizing them:

```bash
kubectl apply -f infra/k8s/k8s-with-replicas-and-internal-ha-db/backup-post-process-pvc.example.yaml
kubectl apply -f infra/k8s/k8s-with-replicas-and-internal-ha-db/backup-post-process-cronjob.example.yaml
```

## Verify

```bash
kubectl rollout status deployment/tavi-api -n tavi
kubectl rollout status deployment/tavi-web -n tavi
kubectl rollout status deployment/tavi-worker -n tavi
kubectl get cluster.postgresql.cnpg.io -n tavi
kubectl get pods -n tavi
```
