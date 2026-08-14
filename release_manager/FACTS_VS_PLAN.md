# BOE_APP Deployment — Verified Facts vs. Plan

Reconciliation of `BeOnEdge Application Deployment.md` against the **actual**
state of the VPS and this repository.

Every line in the "Verified" sections was observed directly (SSH to `beonedge`,
or reading files in this repo). Nothing here is inferred.

Captured: 2026-07-31. Re-verify with `./release_manager/status.sh` → `Diagnose`.

---

## 1. VPS ground truth

| Property | Verified value |
| --- | --- |
| Host | `beonedge-vps`, Ubuntu 26.04 LTS, kernel 7.0.0-28-generic, x86_64 |
| SSH | alias `beonedge` works, key-only, user `beonedge` (uid 1000) |
| Groups | `sudo`, `docker`, `adm`, `lxd` |
| Docker | 29.1.3 — **works without `sudo`** |
| Docker Compose | v5.3.1 (plugin) |
| `sudo -n` (passwordless) | **NOT available** — interactive password required |
| nginx | 1.28.3, active + enabled, host-native |
| nginx sites enabled | `beus`, `tickvault` |
| nginx listening | **`:80` only. No `:443`.** |
| TLS certificates | **None.** `/etc/letsencrypt` does not exist |
| Stack-local `.env` files | Sole runtime configuration source; external secrets overlay retired |
| `/run/lock` | writable by `beonedge` (so `flock` works) |
| Tooling present | `jq sha256sum flock rsync curl gzip tar mountpoint numfmt logger systemctl` |

### Disks / mounts

| Mount | Device | Size | Used | Is mountpoint |
| --- | --- | --- | --- | --- |
| `/` | `/dev/sda2` | 457G | 34G (8%) | — |
| `/srv/dev_stack` | `/dev/sdb1` | 458G | 196M (1%) | yes |
| `/srv/backup` | `/dev/sdd1` | 1.8T | 3.9G (1%) | **yes** |
| `/srv/data` | `/dev/sdc1` | 1.8T | 1.5G (1%) | yes |

All three are in `/etc/fstab` by UUID with `defaults,noatime`. The plan's
`mountpoint -q /srv/backup` guard (§32) is therefore valid and will pass.

### Ports actually in use (TCP LISTEN)

```
22     sshd                       (0.0.0.0)
53     systemd-resolved           (127.0.0.53, 127.0.0.54)
80     nginx                      (0.0.0.0, [::])
631    cups                       (127.0.0.1)
3789   market-data-dwndr-frontend (127.0.0.1)
4000   node — beus                (*)
5432   HOST postgres              (127.0.0.1)   ← not Docker
9000   market-data-dwndr-backend  (127.0.0.1)
20241  cloudflared                (127.0.0.1)
44667  (unidentified)             (127.0.0.1)
34898 / 35134  tailscale          (100.122.85.101 / IPv6)
```

`443` is **free and not bound** — nginx is not yet configured for TLS.

### Docker state

- Running: `market-data-dwndr-frontend` (`127.0.0.1:3789`), `market-data-dwndr-backend` (`127.0.0.1:9000`) — both healthy, both correctly loopback-bound.
- Networks: `bridge`, `host`, `none`, `data-downloader_default`.
- **Volumes: none at all.** BOE_APP starts from zero persistent state.
- Images: many `market-data-dwndr-*` tags, `nginx:alpine`, `boe-present:latest`, `adguard/adguardhome`.

### Network interfaces

```
enp2s0            192.168.1.2/24
wlx1cbfce1488ce   192.168.29.2/24
tailscale0        100.122.85.101/32
docker0           172.17.0.1/16
br-efd2bbd283bd   172.18.0.1/16
```

Two LAN interfaces on different subnets. The plan (§5.1) assumes one reserved
LAN address; the operator must decide **which** interface receives the router's
`80`/`443` forwards. This is an open decision, not a code concern.

### `/srv/dev_stack/BOE_APP` — the scaffold

Every regular file is **0 bytes**. Directory ownership `beonedge:beonedge` (775).
The scaffold shape matches the plan §3 exactly, plus three additions the plan
does not list: `dev_release/paths.json`, `prod_release/paths.json`,
`monitor_service/paths.json`, `monitor_service/ms_apk`, and `.env` / `.env.example`
in both release dirs.

### `/srv/backup/BOE_APP` — **BLOCKER**

```
drwxr-xr-x 6 root root  /srv/backup/BOE_APP
drwxr-xr-x 2 root root  ├── DBS_ROLLBACK
drwxr-xr-x 5 root root  ├── DEV_ROLLBACK/{DEPLOY_IMAGES,DEV_APK,DEV_PSQL_DB}
drwxr-xr-x 4 root root  ├── LOGS/{DEV_LOGS/...,PROD_LOGS/...}
drwxr-xr-x 5 root root  └── PROD_ROLLBACK/{APK,IMAGES,PSQL_DB}
```

Write test as `beonedge`: **`Permission denied`**.

Combined with *no passwordless sudo*, the deploy scripts — which run as
`beonedge` — **cannot create rollback artifacts, DB snapshots, or logs**.
Compare `/srv/backup/DATA_DOWNLOADER`, which *is* `beonedge`-owned and works.

This must be fixed by hand. See `OPERATOR_MANUAL_STEPS.md` step 1.

---

## 2. Reference implementation (proven pattern on this same VPS)

`/srv/dev_stack/DATA_DOWNLOADER/{deploy.sh,rollback.sh}` is a working
air-gapped pipeline on this host. Patterns worth reusing:

- `verify_sha` — `sha256sum` each artifact against `manifest.json`, die on mismatch.
- `env_get` / `set_env` — atomic `.env` edits via `mktemp` + `chmod --reference` + `mv`.
- `compose()` wrapper injecting `--env-file` and `-f`, with a `sudo docker` fallback.
- `wait_http` — bounded polling (30 × 2s, `--max-time 3`).
- Auto-rollback: archive outgoing images *before* loading new ones, restore on health failure.
- `docker image save | gzip -n` (the `-n` keeps digests reproducible).
- Long-syntax ports bound to a `host_ip` variable, defaulting to loopback.
- `x-service-security` YAML anchor: `read_only`, `cap_drop: [ALL]`, `no-new-privileges`, non-root `user`, `init: true`, log caps.

What it **lacks** (and the plan requires): `flock` locking, disk-space checks,
`mountpoint` verification, structured log files, and it never reads `version.json`
(live state lives in `.env` as `APP_VERSION`).

---

## 3. Application ground truth vs. plan assumptions

| Plan assumption | Reality | Impact |
| --- | --- | --- |
| 5 services: landing, user frontend, admin frontend, backend, postgres | The marketing site was removed from this stack (it is a separate AWS-hosted application); the exporter builds three application images — backend, user frontend, admin frontend; Compose supplies PostgreSQL from its pinned upstream release line | Implemented |
| Separate admin + user frontend apps | **One** Vite shell `frontend_stack/app`, switched by build-time `VITE_BEO_APP_TARGET` (`client` → user, unset/`admin` → admin). `packages/admin` and `packages/client` are **libraries**, no Dockerfile | Build `frontend_stack/app` **twice** with different args |
| App and admin images are built separately | `frontend_stack/app/Dockerfile` accepts `VITE_BEO_APP_TARGET` and serves each static bundle with digest-pinned, unprivileged nginx on container port **8080** | Implemented by the release exporter; host ports remain stack-specific |
| Backend health at `/api/health/live`, `/api/health/ready` | Actual routes: **`/health/live`**, **`/health/ready`**, **`/v1/health`** — no `/api` prefix | See §4 decision D1 |
| Backend exposes `/metrics` | **No `/metrics`.** No prom-client / OTel dependency | Monitoring must probe `/health/*` + container state, or instrumentation must be added |
| WebSocket at `/ws/`, `wss://` | **No WebSocket anywhere.** Fastify is HTTP/JSON only; no `ws`, `socket.io`, `@fastify/websocket` | `/ws/` nginx blocks are placeholders; nothing serves them yet |
| Postgres internal, no host binding | Current compose publishes `127.0.0.1:${POSTGRES_HOST_BIND_PORT:-5433}:5432` | Drop the host binding (plan §9.1). Also avoids clashing with the host postgres on 5432 |
| APK dev + prod co-installable | Done at script level, not via Gradle flavors: `emu/boe_update.sh` injects a distinct `applicationId` per target/variant (`-PboeApplicationId`), producing `com.beonedge.app.dev` and `com.beonedge.app.dev.admin` — verified in the sidecars under `emu/out/`. Versioning + release signing are done: `build.gradle` reads injected `boeVersionCode`/`boeVersionName` and signs `assembleRelease` (minified) from the gitignored `android/keystore.properties` | Co-installable today, and hermetic: launcher/splash assets are no longer copied into `src/main/res`. `build.gradle` adds `app/resources/launcher/<variant>` as a resource source directory selected by `-PboeVariant` (default `client`), so a build mutates no tracked file and a bare `gradlew` build gets client branding. applicationId and signing are unchanged — still the injected `-PboeApplicationId`, because those decide update compatibility. Covered by `release_manager/tests/hermetic_branding.test.sh` |
| Admin APK (`dev_admin_apk`, `admin_apk`) | Build path exists: `emu/boe_update.sh --admin` / `--both`, driven by `export.sh`. `scripts/check-android-dist.mjs` guards the **client** build only and is skipped for admin | Guard is filename-based and case-sensitive; it should assert the final APK's contents against the target manifest |

Other confirmed application facts:

- Backend: Fastify 5, Node 22-alpine, container port **47502**, runs as `USER node`.
- Postgres `16-alpine`. Migrations are raw SQL, `backend_controller/db/migrations` (14 files), applied by `npm run migrate` → `dist/scripts/migrate.js up`, recorded with checksums in `schema_migrations` — **editing an applied migration breaks the checksum**.
- Compose ordering contract: `postgres (healthy)` → `migrate (completed)` → `seed` → `backend` + 3 workers → `app_frontend` + `admin_frontend`.
- Workers are the *same* backend image with different commands: `payments-worker`, `email-worker`, `sips-worker`. Omitting them means paid orders never confirm and SIP installments never generate.

---

## 4. Decisions taken (and why)

**D1 — `/api` path handling.** Backend routes have no `/api` prefix, but the plan
mandates same-origin `/api/...` from the browser. Rather than touch application
code, nginx **strips** the prefix:

```nginx
location /api/ { proxy_pass http://127.0.0.1:<BACKEND_PORT>/; }   # trailing / strips /api
```

`/api/health/ready` → `/health/ready` on the backend. This preserves the plan's
same-origin contract with zero code change. Documented in every generated nginx conf.

**D2 — `docker`, not `sudo docker`.** Verified: `docker info` succeeds as
`beonedge`, and `sudo -n` fails. All VPS scripts use plain `docker`.

**D3 — No directory swapping.** The old `mv D D.previous; mv D.next D; rm -rf D.previous`
would destroy sibling stacks and per-stack state now that three stacks live inside
one parent. Shipping now writes **only** the files it owns, in place, and never
deletes a directory it did not create.

**D4 — Postgres has no host port binding.** Per plan §9.1, and it avoids the
host postgres already on `127.0.0.1:5432`.

**D5 — Port block `47410`–`47433`.** Verified free on the VPS. Loopback-bound only.
The operator confirms/edits these in `.env`; scripts never change VPS bindings.

**D6 — Locking.** `flock` on `/run/lock/boe-<stack>.lock` (verified writable),
shared between each stack's deploy and rollback script, per plan §18.

---

## 5. Reserved port registry (all `127.0.0.1`)

Verified free at capture time. **The operator owns these values** — scripts read
them from `.env` and never rewrite VPS bindings.

| Variable | Port | Service |
| --- | --- | --- |
| `PROD_APP_FRONTEND_PORT` | 47411 | Production user SPA |
| `PROD_ADMIN_FRONTEND_PORT` | 47412 | Production admin SPA |
| `PROD_BACKEND_PORT` | 47413 | Production backend (shared) |
| `DEV_APP_FRONTEND_PORT` | 47421 | Development user SPA |
| `DEV_ADMIN_FRONTEND_PORT` | 47422 | Development admin SPA |
| `DEV_BACKEND_PORT` | 47423 | Development backend (shared) |
| `GRAFANA_PORT` | 47430 | Grafana UI |
| `PROMETHEUS_PORT` | 47431 | Prometheus (loopback, for debugging only) |
| `ALERTMANAGER_PORT` | 47432 | Alertmanager (loopback) |
| `BLACKBOX_PORT` | 47433 | Blackbox exporter (loopback) |
| — | none | Postgres (dev + prod): **internal network only** |

Re-check before applying: `ss -lntu | grep ':474'`

---

## 6. Outstanding items requiring the operator (not automatable here)

Ranked by whether they block deployment.

**Blocking:**
1. `chown` `/srv/backup/BOE_APP` to `beonedge` — otherwise no rollback artifacts, DB snapshots, or logs. (`OPERATOR_MANUAL_STEPS.md` §1)
2. Fill each stack-local `.env` and protect it as documented in §2.

**Blocking public access only (deployment works without them):**
3. Choose the LAN interface and set a DHCP reservation; forward router `80`/`443`/`52222`.
4. DNS A records for the 8 hostnames.
5. nginx site configs (generated for you in `release_manager/nginx/`) + `certbot`.
6. UFW policy.

**Application code changes (deliberately out of scope — scripts first):**
7. Add `/metrics` to the backend if Prometheus app-level metrics are wanted.
8. Add WebSocket support if `/ws/` is to be used.
