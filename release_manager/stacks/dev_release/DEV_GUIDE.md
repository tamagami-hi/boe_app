# DEV_RELEASE — development stack, on-VPS guide

This file lives at `/srv/dev_stack/BOE_APP/dev_release/` on the VPS.

The development stack is the integration and tester environment. Per the
deployment plan, **local testing is dev_release testing** — there is no separate
local docker deployment. You build on your machine, ship here, and test here.

Normally driven from the build machine with `./release_manager/deploy.sh --dev`.

---

## How it differs from production

| | dev_release | prod_release |
| --- | --- | --- |
| Confirmation prompt | no | yes |
| Dev-labelled versions | allowed | **refused** |
| `--skip-db-backup` | allowed | refused |
| Rollback releases kept | 3 | 5 |
| Container prefix | `boe-dev-` | `boe-` |
| Compose project | `boe_dev` | `boe_prod` |
| Database | `boe_app_dev` | `boe_app` |
| Configuration | `dev_release/.env` | `prod_release/.env` |
| Access | basic auth + app login | app login |

Nothing is shared: separate database, volume, networks, container names, ports
and secrets. A dev container must never join a production network.

**The development database must not contain production customer data.**

---

## First-time setup

```bash
cd /srv/dev_stack/BOE_APP/dev_release
cp .env.example .env
chmod 600 .env
$EDITOR .env
```

---

## Deploy

```bash
./dev_deploy.sh                 # no prompt — dev is redeployed constantly
./dev_deploy.sh --force         # redeploy the same version
./dev_deploy.sh --skip-checks   # start without gating on health
./dev_deploy.sh --skip-db-backup
```

The flow is identical to production (see `PROD_GUIDE.md`) minus the confirmation
and the stable-version gate.

## Roll back

```bash
./dev_rollback.sh --list
./dev_rollback.sh --latest
./dev_rollback.sh --to 0.6.4-dev.18.g62274c0
./dev_rollback.sh --to 0.6.4-dev.18.g62274c0 --restore-db
```

Because dev data is disposable, `--restore-db` is far less consequential here —
it is still an explicit, confirmed operation.

---

## Inspect

```bash
jq . dev-version.json
docker compose --project-name boe_dev -f docker-compose.dev_app.yml ps
docker compose --project-name boe_dev -f docker-compose.dev_app.yml logs -f backend
curl -fsS http://127.0.0.1:47423/health/ready | jq .
ls -t /srv/backup/BOE_APP/LOGS/DEV_LOGS/DEV_DEPLOY_LOGS/ | head
```

## Reset the development database

Only ever do this here. There is no equivalent for production.

```bash
docker compose --project-name boe_dev -f docker-compose.dev_app.yml down
docker volume rm boe_dev_postgres_data
./dev_deploy.sh --force
```

Migrations and seeding re-run automatically on the empty volume.

---

## Ports

All bound to `127.0.0.1`.

| Variable | Port |
| --- | --- |
| `LANDING_PORT` | 47420 |
| `APP_FRONTEND_PORT` | 47421 |
| `ADMIN_FRONTEND_PORT` | 47422 |
| `BACKEND_PORT` | 47423 |
| postgres | none — internal network only |

---

## Tester access

`dev-app.beonedge.in` and `dev-admin.beonedge.in` are internet-reachable, so they
carry a second layer in front of the application login:

- HTTP basic auth (`/etc/nginx/auth/dev-testers.htpasswd`)
- `X-Robots-Tag: noindex, nofollow, noarchive`
- separate development accounts
- no production data

Add a tester:

```bash
sudo htpasswd /etc/nginx/auth/dev-testers.htpasswd newtester
```

No nginx reload is needed — the file is read per request.

---

## The development APK

Built on the build machine, not here:

```bash
./emu/boe_update.sh --dev --both      # points at https://dev-app.beonedge.in/api
./emu/boe_update.sh --local --client  # points at a local backend, installs to the emulator
```

Deploying with a bundle that contains APKs publishes them into `dev_apk/` and
`dev_admin_apk/` automatically.

> Current limitation: dev and prod APKs share the applicationId
> `com.beonedge.app`, so they cannot be installed on the same device at the same
> time. See `FACTS_VS_PLAN.md` §6 item 8.
