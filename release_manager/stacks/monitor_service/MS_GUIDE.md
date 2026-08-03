# MONITOR_SERVICE — monitoring stack, on-VPS guide

This file lives at `/srv/dev_stack/BOE_APP/monitor_service/` on the VPS.

The monitoring stack is deployed and rolled back **independently** of the two
application stacks, and must keep running through an application deploy or
rollback. It has its own lock, compose project and networks.

---

## How it differs from the application stacks

**It ships no image tarballs.** Prometheus, Grafana, Alertmanager and the
exporters are pinned upstream images, so `ms_deploy.sh` *pulls* them instead of
loading archives. Nothing from the repository is built into it yet.

**It owns no database**, so there are no pre-deployment `pg_dump` steps.

**A "version" here is a configuration revision**, not an image tag. Rollback
restores the previous compose file and `config/` tree and re-pulls that
revision's pinned tags.

---

## Components

| Service | Exposure | Purpose |
| --- | --- | --- |
| `grafana` | `127.0.0.1:47430` → nginx | Dashboards. The only publicly proxied service. |
| `prometheus` | `127.0.0.1:47431` | Metrics store. Loopback debugging only. |
| `alertmanager` | `127.0.0.1:47432` | Alert routing. Loopback only. |
| `blackbox_exporter` | `127.0.0.1:47433` | External HTTPS / TLS / readiness probes. |
| `node_exporter` | internal | Host CPU, memory, disk, network. |
| `cadvisor` | internal | Per-container CPU, memory, restarts. |
| `postgres_exporter_prod` | internal, profile `with-prod-db` | Production database internals. |
| `postgres_exporter_dev` | internal, profile `with-dev-db` | Development database internals. |

### No Docker socket, deliberately

`/var/run/docker.sock` is **not** mounted into any container. Mounting it is
equivalent to granting that container root on the host (plan §30.1). Container
metrics come from cAdvisor's read-only cgroup and proc mounts instead, and
database backups are host-side systemd jobs, not container jobs.

---

## First-time setup

```bash
cd /srv/dev_stack/BOE_APP/monitor_service
cp .env.example .env
chmod 600 .env
$EDITOR .env      # GRAFANA_ADMIN_PASSWORD is required
```

---

## Deploy

```bash
./ms_deploy.sh
```

Then reach Grafana over the tunnel or via nginx:

```bash
ssh -L 3000:127.0.0.1:47430 beonedge
# then open http://localhost:3000
```

## Roll back

```bash
./ms_rollback.sh --list
./ms_rollback.sh --latest
```

---

## Enabling the database exporters

The exporters are behind compose profiles so the monitoring stack can start
before the application stacks exist. Enable them **after** the app stack is up,
because they attach to that stack's internal network.

Create a monitoring-only role first — never reuse the application user:

```sql
CREATE USER boe_monitor WITH PASSWORD '<strong>';
GRANT pg_monitor TO boe_monitor;
```

```bash
docker exec -i boe-postgres psql -U boe_app -d boe_app <<'SQL'
CREATE USER boe_monitor WITH PASSWORD 'CHANGE_ME';
GRANT pg_monitor TO boe_monitor;
SQL
```

Put the DSN in `monitor_service/.env`:

```
PROD_PG_EXPORTER_DSN=postgresql://boe_monitor:CHANGE_ME@postgres:5432/boe_app?sslmode=disable
```

Then:

```bash
docker compose --project-name boe_monitor \
  --env-file .env -f docker-compose.monitor_service.yml \
  --profile with-prod-db up -d
```

---

## Configuration

Everything is in `config/`, shipped from the repository and mounted read-only:

```
config/
├── prometheus/prometheus.yml          scrape targets
├── prometheus/rules/boe-alerts.yml    alert rules
├── alertmanager/alertmanager.yml      routing (ships with a null receiver)
├── blackbox/blackbox.yml              probe modules
└── grafana/provisioning/              datasources + dashboard providers
```

Edit these **in the repository**, not here — they are overwritten by the next
deploy. Reload Prometheus without a restart:

```bash
curl -X POST http://127.0.0.1:47431/-/reload
```

---

## What monitoring cannot see yet

- **No application metrics.** The backend exposes no `/metrics` endpoint, so
  there are no request-rate, latency or auth-failure series. Coverage is host,
  container and blackbox probes. The scrape jobs are written and commented out in
  `prometheus.yml`, ready for when the endpoint exists.
- **No WebSocket metrics** — the backend has no WebSocket support.
- **No log aggregation.** Loki and Promtail are a later phase; use
  `docker compose logs` for now.
- **No notifications until you configure a receiver.** Alerts fire and are
  visible in Grafana and Alertmanager, but nothing is sent. See the commented
  email and Telegram examples in `config/alertmanager/alertmanager.yml`.

---

## Useful checks

```bash
# scrape target health — the fastest way to see what monitoring is blind to
curl -s http://127.0.0.1:47431/api/v1/targets | jq -r '.data.activeTargets[] | "\(.health)\t\(.labels.job)\t\(.lastError // "")"'

# currently firing alerts
curl -s http://127.0.0.1:47431/api/v1/alerts | jq -r '.data.alerts[] | "\(.labels.severity)\t\(.labels.alertname)\t\(.state)"'

# grafana health
curl -s http://127.0.0.1:47430/api/health | jq .

# certificate expiry as measured from outside
curl -s 'http://127.0.0.1:47433/probe?module=http_2xx&target=https://app.beonedge.in' | grep ssl_earliest
```

Targets showing `down` for `postgres_prod` / `postgres_dev` are expected until
the exporter profiles are enabled, and `nginx` requires the `stub_status` block
from `release_manager/nginx/boe-shared.conf` to be installed.
