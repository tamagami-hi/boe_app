# BOE_APP — Manual Operator Steps

Everything in this file must be run **by you, on the VPS**. The deploy pipeline
deliberately does not do any of it, because each item either needs root, changes
a shared service, or is a decision that should not be made by a script.

Verify progress at any time with:

```bash
./release_manager/status.sh --diagnose
```

Sections are ordered by dependency. §1 and §2 block deployment. §3–§7 block
public access only — the stacks will deploy and run on loopback without them.

Connect with:

```bash
ssh beonedge
```

---

## §1 — Make the backup tree writable  **(BLOCKING)**

### Why

`/srv/backup/BOE_APP` is currently `root:root` mode `755`. The deploy scripts run
as `beonedge`, and this VPS has **no passwordless sudo**, so they cannot write
rollback images, database snapshots, or logs. Every deploy would abort at step 3.

Verified current state:

```
drwxr-xr-x 6 root root /srv/backup/BOE_APP
```

Compare `/srv/backup/DATA_DOWNLOADER`, which is already `beonedge`-owned and works.

### Do this

```bash
sudo chown -R beonedge:beonedge /srv/backup/BOE_APP
sudo chmod -R u+rwX,go+rX /srv/backup/BOE_APP
```

### Verify

```bash
ls -ld /srv/backup/BOE_APP
touch /srv/backup/BOE_APP/.wtest && echo WRITABLE && rm /srv/backup/BOE_APP/.wtest
```

Expect `beonedge beonedge` and `WRITABLE`.

The deploy scripts create the remaining subdirectories themselves
(`DEV_ROLLBACK/…`, `DB_BACKUPS/…`, `LOGS/…/DEPLOY_LOGS`) on first use. Do not
pre-create them.

---

## §2 — Protect the stack-local `.env` files  **(BLOCKING)**

### Why

Each stack's `.env` is the only runtime configuration source, including secrets.
It lives on the VPS, is excluded from release shipping, and must never enter git,
logs, rollback archives, or support messages.

### Do this

Generate the token and crypto key set **on your build machine**:

```bash
cd backend_controller && npm run keys:generate
```

Then paste the values in. Required keys are listed at the bottom of
`release_manager/stacks/prod_release/.env.example`.

> Production and development must use **different values** for every secret.
> Sharing a signing key between them means a dev token is valid in production.

### Ownership and readability

Use one of the two accepted policies:

- deploy-user-owned: `beonedge:beonedge`, mode `600`
- production root-owned: `root:beonedge`, mode `640`

The deployment fails before Docker if `.env` is missing, empty, unreadable,
symlinked, hard-linked, malformed, duplicated, or has broader permissions.

### Verify

```bash
stat -c '%U:%G %a %n' /srv/dev_stack/BOE_APP/{dev_release,prod_release,monitor_service}/.env
```

---

## §3 — Fill in each stack's `.env`

`deploy.sh` uploads `.env.example` but **never** overwrites `.env`. Create it once
per stack, on the VPS.

```bash
cd /srv/dev_stack/BOE_APP/dev_release   && cp .env.example .env && chmod 600 .env
cd /srv/dev_stack/BOE_APP/prod_release  && cp .env.example .env && chmod 600 .env
cd /srv/dev_stack/BOE_APP/monitor_service && cp .env.example .env && chmod 600 .env
```

Then edit each and set every required value, including secrets. The port defaults
are already filled in and verified free — see §4 before changing them.

---

## §4 — Port registry

### Why you own this

The pipeline never changes host port bindings. Compose reads them from `.env`,
and nginx must be told the same numbers. Changing a port is therefore a
two-file, one-reload operation that you perform.

### Verified free at the time of writing

Currently in use on the VPS:

```
22  53  80  631  3789  4000  5432  9000  20241  44667
```

Note `5432` is a **host** postgres, not Docker. The BOE_APP databases have no
host port at all, so there is no conflict.

### The registry

All bound to `127.0.0.1` only.

| Stack | Variable | Port | Service |
| --- | --- | --- | --- |
| prod | `LANDING_PORT` | 47410 | landing (Next.js) |
| prod | `APP_FRONTEND_PORT` | 47411 | user SPA |
| prod | `ADMIN_FRONTEND_PORT` | 47412 | admin SPA |
| prod | `BACKEND_PORT` | 47413 | backend |
| dev | `LANDING_PORT` | 47420 | landing |
| dev | `APP_FRONTEND_PORT` | 47421 | user SPA |
| dev | `ADMIN_FRONTEND_PORT` | 47422 | admin SPA |
| dev | `BACKEND_PORT` | 47423 | backend |
| monitor | `GRAFANA_PORT` | 47430 | Grafana |
| monitor | `PROMETHEUS_PORT` | 47431 | Prometheus (debug only) |
| monitor | `ALERTMANAGER_PORT` | 47432 | Alertmanager (debug only) |
| monitor | `BLACKBOX_PORT` | 47433 | Blackbox exporter (debug only) |
| both | — | none | Postgres — internal network only |

### Confirm they are still free before first deploy

```bash
for p in 47410 47411 47412 47413 47420 47421 47422 47423 47430 47431 47432 47433; do
  if ss -lntu | grep -q ":$p "; then echo "$p IN USE"; else echo "$p free"; fi
done
```

### To change a port

1. Edit the stack's `.env` on the VPS.
2. Edit the matching `proxy_pass` in the nginx site config.
3. `sudo nginx -t && sudo systemctl reload nginx`
4. Re-run the deploy so compose republishes: `./release_manager/deploy.sh --dev`

Never expose `PROMETHEUS_PORT`, `ALERTMANAGER_PORT` or `BLACKBOX_PORT` through
nginx. They are loopback debugging ports.

---

## §5 — Network, DNS and TLS

### 5.1 Pick the LAN interface  **(decision required)**

The VPS has two LAN interfaces on different subnets:

```
enp2s0            192.168.1.2/24     (wired)
wlx1cbfce1488ce   192.168.29.2/24    (wireless)
```

Router port forwarding can only target one. Choose the **wired** interface
(`enp2s0`, `192.168.1.2`) unless there is a specific reason not to.

Then, on the router, create a **DHCP reservation** tying `192.168.1.2` to the
MAC address of `enp2s0`:

```bash
ip link show enp2s0 | awk '/ether/ {print $2}'
```

Without a reservation the address can change and every forward silently breaks.

### 5.2 Router port forwarding

| External | → | Internal |
| --- | --- | --- |
| TCP 80 | → | 192.168.1.2:80 |
| TCP 443 | → | 192.168.1.2:443 |
| TCP 52222 | → | 192.168.1.2:22 |

Forward **nothing else**. No backend, frontend, postgres, Grafana or Prometheus
port should ever be reachable from the internet.

Port 80 is required for HTTP-01 certificate validation and the HTTPS redirect.

### 5.3 DNS records

All A records point at the router's static public IP:

```
A   @           <STATIC_PUBLIC_IP>
A   www         <STATIC_PUBLIC_IP>
A   app         <STATIC_PUBLIC_IP>
A   admin       <STATIC_PUBLIC_IP>
A   dev         <STATIC_PUBLIC_IP>
A   dev-app     <STATIC_PUBLIC_IP>
A   dev-admin   <STATIC_PUBLIC_IP>
A   monitor     <STATIC_PUBLIC_IP>
```

Confirm the public IP is not CGNAT — inbound connections must reach the router:

```bash
curl -s https://api.ipify.org; echo
```

Compare with the WAN address shown in the router's admin UI. If they differ, the
ISP is using CGNAT and inbound forwarding cannot work.

Verify propagation before requesting certificates:

```bash
for h in beonedge.in app.beonedge.in admin.beonedge.in dev-app.beonedge.in \
         dev-admin.beonedge.in dev.beonedge.in monitor.beonedge.in; do
  printf '%-26s %s\n' "$h" "$(dig +short "$h" | tr '\n' ' ')"
done
```

### 5.4 Install the nginx site configs

Generated for you in `release_manager/nginx/`. Copy them up, then enable:

```bash
# from your build machine
scp release_manager/nginx/*.conf beonedge:/tmp/

# on the VPS
sudo cp /tmp/beonedge.in.conf        /etc/nginx/sites-available/boe-landing
sudo cp /tmp/app.beonedge.in.conf    /etc/nginx/sites-available/boe-app
sudo cp /tmp/admin.beonedge.in.conf  /etc/nginx/sites-available/boe-admin
sudo cp /tmp/dev-app.beonedge.in.conf   /etc/nginx/sites-available/boe-dev-app
sudo cp /tmp/dev-admin.beonedge.in.conf /etc/nginx/sites-available/boe-dev-admin
sudo cp /tmp/monitor.beonedge.in.conf   /etc/nginx/sites-available/boe-monitor
sudo cp /tmp/boe-shared.conf            /etc/nginx/conf.d/boe-shared.conf

for s in boe-landing boe-app boe-admin boe-dev-app boe-dev-admin boe-monitor; do
  sudo ln -sfn /etc/nginx/sites-available/$s /etc/nginx/sites-enabled/$s
done

sudo nginx -t && sudo systemctl reload nginx
```

`boe-shared.conf` must go in `conf.d/` — it holds the `http`-level
`map $http_upgrade $connection_upgrade` and the rate-limit zones that the site
configs reference.

> The configs as shipped contain **only the port-80 server blocks**. Certbot adds
> the `443` blocks in step 5.5. This ordering matters: certbot needs a working
> port-80 vhost for each hostname before it can validate.

### 5.5 Obtain certificates

There is currently **no** `/etc/letsencrypt` and nothing listening on `:443`.

```bash
sudo apt install -y certbot python3-certbot-nginx

sudo certbot --nginx -d beonedge.in -d www.beonedge.in
sudo certbot --nginx -d app.beonedge.in
sudo certbot --nginx -d admin.beonedge.in
sudo certbot --nginx -d dev.beonedge.in -d dev-app.beonedge.in -d dev-admin.beonedge.in
sudo certbot --nginx -d monitor.beonedge.in
```

Verify renewal actually works — an expired certificate is a silent outage:

```bash
systemctl status certbot.timer
sudo certbot renew --dry-run
```

### 5.6 Protect the development and monitoring hosts

The dev stack is for a handful of testers, and Grafana should never be publicly
readable. Add HTTP basic auth in front of the application's own login (plan §11).

```bash
sudo apt install -y apache2-utils
sudo install -d -m 750 -o root -g www-data /etc/nginx/auth

sudo htpasswd -c /etc/nginx/auth/dev-testers.htpasswd tester1
sudo htpasswd    /etc/nginx/auth/dev-testers.htpasswd tester2
sudo htpasswd -c /etc/nginx/auth/monitor.htpasswd     operator

sudo chmod 640 /etc/nginx/auth/*.htpasswd
sudo chown root:www-data /etc/nginx/auth/*.htpasswd
```

The shipped dev and monitor configs already reference these files — uncomment the
`auth_basic` lines once the files exist, then reload nginx.

---

## §6 — Firewall

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp        # router maps external 52222 → 22
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
```

Do **not** add rules for the 474xx ports. They are loopback-bound; UFW never
sees that traffic, and opening them would be actively harmful if a binding were
ever changed to `0.0.0.0`.

> Docker publishes ports by writing iptables rules that can bypass UFW. The
> protection here is that every compose port is written as
> `"127.0.0.1:PORT:PORT"`. Keep it that way.

---

## §7 — SSH hardening

Review, then apply, in `/etc/ssh/sshd_config` (or a drop-in under
`/etc/ssh/sshd_config.d/`):

```
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
MaxAuthTries 3
LoginGraceTime 30
X11Forwarding no
AllowUsers beonedge
```

```bash
sudo sshd -t && sudo systemctl reload ssh
```

Keep your current session open until you have confirmed a new one works.

```bash
sudo apt install -y fail2ban
sudo systemctl enable --now fail2ban
```

---

## §8 — First deployment

Once §1–§3 are done, from your build machine:

```bash
# 1. confirm the VPS is ready
./release_manager/status.sh --diagnose

# 2. build and stage the development bundle
./release_manager/export.sh --dev

# 3. upload without deploying, so you can inspect first
./release_manager/deploy.sh --dev --ship-only

# 4. create .env on the VPS if you have not yet (§3), then deploy
./release_manager/deploy.sh --dev
```

Then check it:

```bash
ssh beonedge 'curl -fsS http://127.0.0.1:47423/health/ready; echo'
ssh beonedge 'cd /srv/dev_stack/BOE_APP/dev_release && docker compose --project-name boe_dev -f docker-compose.dev_app.yml ps'
```

Production follows the same route, but requires a cut release first:

```bash
./release_manager/status.sh        # option 5 prepares Git; option 6 cuts a release
./release_manager/export.sh --prod
./release_manager/deploy.sh --prod
```

---

## §9 — Application changes still outstanding

These are code changes, deliberately out of scope of the deployment scripts.
Each is currently detected and reported rather than silently worked around.

1. **`frontend_stack/app/Dockerfile` needs `ARG VITE_BEO_APP_TARGET`.**
   Without it the user and admin images build identically. `export.sh` refuses to
   proceed and prints the exact two lines to add.

2. **Gradle product flavors + release signing** (`android/app/build.gradle`).
   Today one `applicationId` means dev and prod APKs cannot be co-installed, and
   `--prod` yields a debug-signed APK. `boe_update.sh` warns about both.

3. **Backend `/metrics` endpoint.** None exists, so Prometheus has no
   application-level series. Monitoring currently covers host, container and
   blackbox probes only.

4. **WebSocket support.** The backend has none. The `/ws/` blocks in the nginx
   configs are commented out; uncomment them when there is something to serve.

5. **Backend health paths.** Real routes are `/health/live` and `/health/ready`
   with no `/api` prefix. The nginx configs strip `/api` before proxying, so
   `/api/health/ready` works publicly with no code change. If you later add an
   `/api` prefix in the application, remove the trailing slash from
   `proxy_pass` in every config.
