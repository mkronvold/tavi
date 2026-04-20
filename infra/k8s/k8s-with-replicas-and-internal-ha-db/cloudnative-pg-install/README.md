# CloudNativePG operator install

This kustomization pins the HA PostgreSQL variant to the CloudNativePG upstream `1.29.0` operator manifest.

Installing it requires permissions to create cluster-scoped resources such as CRDs, ClusterRoles, admission webhooks, and resources in the `cnpg-system` namespace.

That upstream manifest includes:

1. The `cnpg-system` namespace.
2. The CloudNativePG CRDs.
3. The operator deployment, RBAC, webhook, and supporting services.

## Install or upgrade

```bash
kubectl apply --server-side -k infra/k8s/k8s-with-replicas-and-internal-ha-db/cloudnative-pg-install
kubectl rollout status deployment/cnpg-controller-manager -n cnpg-system
```

## Verify

```bash
kubectl get deployment -n cnpg-system cnpg-controller-manager
kubectl get crd | rg 'postgresql.cnpg.io'
```

## Updating the pinned operator version

Edit `kustomization.yaml` and replace the upstream release URL with the newer CloudNativePG patch or minor release you want to standardize on for this Tavi variant.
