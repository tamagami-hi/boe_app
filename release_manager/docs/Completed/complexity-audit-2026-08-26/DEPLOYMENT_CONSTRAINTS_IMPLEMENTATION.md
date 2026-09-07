# Deployment constraints implementation

Captured 2026-08-27 from the tracked release-manager contracts.

## Confirmed boundaries

The application has two isolated application stacks:

- `dev_release` at `/srv/dev_stack/BOE_APP/dev_release`
- `prod_release` at `/srv/dev_stack/BOE_APP/prod_release`

Each stack has its own PostgreSQL service, persistent PostgreSQL volume, Redis
service, Redis volume, internal network, frontend network, egress network,
container-name prefix, Compose project, ports, and stack-local `.env`. Neither
Compose file publishes a PostgreSQL host port. The separation is enforced by
`release_manager/tests/runtime_contract.test.sh` and the path contracts in
`release_manager/stacks/dev_release/paths.json` and
`release_manager/stacks/prod_release/paths.json`.

Redis is retained as shared read-cache infrastructure. The application uses
the stack-local Redis service through `REDIS_URL` and separates cache keys with
`REDIS_KEY_NAMESPACE=boe-dev` and `REDIS_KEY_NAMESPACE=boe-prod`. Redis is not
the source of truth for users, payments, transactions, or balances.

The dev and production Compose files now expose the same backend environment
key contract. Environment values remain intentionally different where they
identify the deployment, including `NODE_ENV`, public origins, ports, database
names, APK directories, and `PHONEPE_ENV`. The PhonePe provider remains
application-selected from environment configuration; the release scripts do
not reject either `sandbox` or `production` based on the stack. The application
source and Dockerfile are shared by `release_manager/export.sh`, which builds
the backend and both frontend targets from the same working tree.

## Artifact promotion limitation

The current exporter builds a dev bundle and a production bundle separately.
They use the same source commit when exported from the same release, but the
frontend API base is currently baked into each Vite build (`DEV_API_BASE` versus
`PROD_API_BASE` in `release_manager/export.sh`). Therefore the resulting
frontend archives are not byte-identical artifacts that can be promoted from
dev to production. This is an application-build limitation, not a deployment
stack divergence. A future artifact-promotion change should first make the
frontend API base runtime-relative or provide a single runtime configuration
mechanism; it must not silently claim that separately built archives are the
same artifact.

## Monitoring extraction boundary

`release_manager/stacks/monitor_service/` is currently a separate Compose
project and release-manager stack containing only pinned upstream monitoring
images and read-only configuration. It is not imported by the backend or
frontend and it has no business-data write path. It uses monitoring-only
PostgreSQL exporter credentials when enabled and does not mount the Docker
socket.

The directory remains temporarily tracked so the existing operator-controlled
deployment pipeline is not broken. It is outside the BOE_APP business runtime
scope and is the extraction boundary for the planned independent monitoring
repository. Future extraction must preserve health/metrics/log/audit emission
from BOE_APP while moving collection, storage, dashboards, alerts, and backup
operations to the separate monitoring repository. The monitoring UI must never
receive arbitrary production database write access.

## Verification

The deployment contract check passes after these constraints were added:

```text
bash release_manager/tests/runtime_contract.test.sh
PASS: runtime hardening and service health contracts are consistent
```

The complete release-manager test suite should be run by the integrating agent
before the final commit. Runtime isolation and VPS ownership still require
operator verification on the target host; static repository checks cannot
prove the actual Docker volumes, networks, credentials, or deployed paths.
