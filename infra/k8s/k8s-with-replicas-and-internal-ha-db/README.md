# Kubernetes path: replicas with internal HA database

Use this path when the cluster should run the app at three replicas and PostgreSQL should be managed in-cluster as a three-instance CloudNativePG cluster.

## Deploys

| Component                     | Manifest                                                                           |
| ----------------------------- | ---------------------------------------------------------------------------------- |
| Namespace                     | `namespace.yaml`                                                                   |
| CloudNativePG operator + CRDs | `cloudnative-pg-install/`                                                          |
| Tavi stack kustomization      | `kustomization.yaml`                                                               |
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

1. Permissions to install the pinned CloudNativePG operator bundle from `cloudnative-pg-install/`, including cluster-scoped CRDs, ClusterRoles, admission webhooks, and resources in `cnpg-system`.
2. A Kubernetes storage class suitable for CloudNativePG volumes.
3. A compatible ingress controller. The checked-in ingress manifest defaults to `ingressClassName: contour`.
4. Capacity for three API pods, three web pods, three worker pods, and a three-instance PostgreSQL cluster.

## Configure

1. Edit `configmap.yaml` and `ingress.yaml` for your public hostname.
2. Create the three real secrets from `secret.example.yaml` so you can apply them before the stack kustomization:
   - `tavi-secrets`
   - `tavi-postgres-app`
   - `tavi-postgres-superuser`
3. Keep `DATABASE_URL` pointed at the CloudNativePG read-write service `tavi-postgres-rw`.
4. Adjust the storage size in `postgres-cluster.yaml` if `10Gi` is not appropriate.
5. Update `backup-pvc.yaml` if your cluster needs a different storage class or size. The API and worker share this PVC across replica sets, so the storage class must support `ReadWriteMany`.
6. If you need downstream archival or off-cluster replication, customize `backup-post-process-pvc.example.yaml` and `backup-post-process-cronjob.example.yaml`.
7. The root `kustomization.yaml` intentionally excludes example secrets and optional backup post-process templates.

## Install

```bash
kubectl apply --server-side -k infra/k8s/k8s-with-replicas-and-internal-ha-db/cloudnative-pg-install
kubectl rollout status deployment/cnpg-controller-manager -n cnpg-system
kubectl apply -k infra/k8s/k8s-with-replicas-and-internal-ha-db
```

The pinned CloudNativePG install bundle creates the `cnpg-system` namespace, installs the `postgresql.cnpg.io` CRDs, and rolls out the operator before the root stack `kustomization.yaml` applies `postgres-cluster.yaml` and the rest of the Tavi manifests.

Apply the post-process templates only after customizing them:

```bash
kubectl apply -f infra/k8s/k8s-with-replicas-and-internal-ha-db/backup-post-process-pvc.example.yaml
kubectl apply -f infra/k8s/k8s-with-replicas-and-internal-ha-db/backup-post-process-cronjob.example.yaml
```

## Verify

```bash
kubectl get deployment -n cnpg-system cnpg-controller-manager
kubectl get crd | rg 'postgresql.cnpg.io'
kubectl rollout status deployment/tavi-api -n tavi
kubectl rollout status deployment/tavi-web -n tavi
kubectl rollout status deployment/tavi-worker -n tavi
kubectl get cluster.postgresql.cnpg.io -n tavi
kubectl get pods -n tavi
```
