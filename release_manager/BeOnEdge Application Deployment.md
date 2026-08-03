# BeOnEdge Application Deployment, Networking, Security, Monitoring and Backup Architecture

## 1. Purpose

This document defines the deployment and infrastructure architecture for the BeOnEdge application running on the company VPS.

The system will use:

* Docker Compose for application orchestration
* Host-native Nginx as the public reverse proxy
* PostgreSQL as an internal Docker service
* Separate development and production stacks
* Separate development and production Android APKs
* Air-gapped, operator-controlled release delivery
* Version-controlled image backup and rollback
* Prometheus and Grafana for monitoring
* Automated PostgreSQL backups managed by the monitoring system
* HTTPS through the `beonedge.in` domain
* SSH access using private keys only
* No application source code stored on the VPS

The architecture intentionally avoids Kubernetes for now. The number of services, deployment frequency, and single-server topology do not currently justify the operational complexity of Kubernetes.

---

# 2. Core Architectural Principles

## 2.1 Build and runtime separation

The personal development computer will act as the:

* Source-code environment
* Git repository
* Build environment
* Testing environment
* Docker image builder
* APK builder
* Release packager
* Deployment artifact origin

The VPS will act as the:

* Runtime environment
* Docker image consumer
* Deployment executor
* Rollback controller
* Reverse-proxy host
* Database host
* Monitoring host
* Backup controller

The VPS will not contain:

* Application source code
* Git repositories for the application
* Compiler toolchains required to build the application
* Node.js or Rust development source trees
* Automatic access to the source repository
* Automatic image-registry pull credentials

The VPS receives only the files required to run a release.

---

## 2.2 Air-gapped deployment model

Application releases will be deliberately transferred from the personal computer to the VPS.

```text
Source code
    │
    ▼
Local testing
    │
    ▼
Docker image build
    │
    ▼
docker save
    │
    ▼
gzip compression
    │
    ▼
SHA-256 verification data
    │
    ▼
rsync transfer
    │
    ▼
VPS deployment scripts
    │
    ▼
Docker Compose deployment
```

The VPS will not automatically discover or download releases.

This provides:

* Controlled production changes
* Reduced dependency on external registries
* Smaller attack surface
* No accidental automatic updates
* Predictable release inputs
* Clear responsibility for each deployment
* Independence from Docker Hub or another image registry

The `dev_release` and `prod_release` directories themselves are the deployment bundle locations. Separate `current` and `incoming` release directories are not required.

---

# 3. Existing Filesystem Structure

```text
/srv/dev_stack/BOE_APP/
├── dev_release
│   ├── dev_admin_apk
│   ├── dev_apk
│   ├── dev_deploy.sh
│   ├── DEV_GUIDE.md
│   ├── dev_psql_db
│   ├── dev_rollback.sh
│   ├── dev-version.json
│   ├── docker-compose.dev_app.yml
│   └── images
├── manifest.json
├── monitor_service
│   ├── docker-compose.monitor_service.yml
│   ├── images
│   ├── monitor_service-version.json
│   ├── ms_deploy.sh
│   ├── MS_GUIDE.md
│   └── ms_rollback.sh
├── prod_release
│   ├── admin_apk
│   ├── docker-compose.prod_app.yml
│   ├── images
│   ├── prod_apk
│   ├── prod_deploy.sh
│   ├── PROD_GUIDE.md
│   ├── prod_rollback.sh
│   ├── psql_db
│   └── release-version.json
└── README.md
```

Rollback and backup storage:

```text
/srv/backup/BOE_APP/
├── DBS_ROLLBACK
├── DEV_ROLLBACK
│   ├── DEPLOY_IMAGES
│   ├── DEV_APK
│   └── DEV_PSQL_DB
├── LOGS
│   ├── DEV_LOGS
│   │   ├── DEV_IMAGE_LOGS
│   │   └── DEV_PSQL_DB_LOGS
│   └── PROD_LOGS
│       ├── IMAGE_LOGS
│       └── PSQL_DB_LOGS
└── PROD_ROLLBACK
    ├── APK
    ├── IMAGES
    └── PSQL_DB
```

The existing structure is valid. The purpose of each directory should be documented precisely so scheduled backups, release rollback artifacts, logs, and emergency database restore points are not confused with one another.

---

# 4. High-Level Runtime Topology

```text
                               Internet
                                  │
                                  ▼
                         Static Public IP
                                  │
                                  ▼
                         JioFiber Router
                    ┌─────────────┼─────────────┐
                    │             │             │
             WAN 80 → VPS 80  WAN 443 → VPS 443
                    │             │
                    └──────┬──────┘
                           ▼
                      Host Nginx
                         :80/:443
                           │
         ┌─────────────────┼─────────────────────┐
         │                 │                     │
         ▼                 ▼                     ▼
  Production stack   Development stack    Monitoring stack
         │                 │                     │
         ▼                 ▼                     ▼
   Localhost ports    Localhost ports       Localhost or
                                             internal ports
```

SSH will remain separate:

```text
Internet TCP 52222
        │
        ▼
Router port forwarding
        │
        ▼
VPS TCP 22
        │
        ▼
OpenSSH
Private-key authentication only
```

Only the following router ports should normally be forwarded:

* External TCP `80` to VPS TCP `80`
* External TCP `443` to VPS TCP `443`
* External TCP `52222` to VPS TCP `22`

No frontend, backend, PostgreSQL, Prometheus, Grafana, or Docker service port should be forwarded directly through the router.

---

# 5. Network Identity Requirements

Two separate static-address concepts are required.

## 5.1 Static or reserved VPS LAN address

The router must always assign the same private LAN address to the VPS.

Example:

```text
VPS LAN address: 192.168.x.x
```

This should be configured using a DHCP reservation tied to the VPS network-interface MAC address.

All port-forwarding rules must point to this reserved LAN address.

## 5.2 Static public WAN address

The public DNS records for `beonedge.in` and its subdomains must point to the static public IP assigned to the router by the ISP.

The public IP must not be a CGNAT-only address. Incoming connections must reach the router directly.

---

# 6. Recommended Domain Structure

The domain design should separate public, user, administrator, development, and monitoring interfaces.

| Hostname                | Purpose                                                |
| ----------------------- | ------------------------------------------------------ |
| `beonedge.in`           | Public landing website                                 |
| `www.beonedge.in`       | Redirect to the main landing website                   |
| `app.beonedge.in`       | Production user web application and production APK API |
| `admin.beonedge.in`     | Production administrator application                   |
| `dev-app.beonedge.in`   | Development user application and development APK API   |
| `dev-admin.beonedge.in` | Development administrator application                  |
| `monitor.beonedge.in`   | Grafana or the dedicated monitoring application        |
| `ssh.beonedge.in`       | Optional DNS name for SSH access                       |

The DNS records may be configured as:

```text
A    @             <STATIC_PUBLIC_IP>
A    www           <STATIC_PUBLIC_IP>
A    app           <STATIC_PUBLIC_IP>
A    admin         <STATIC_PUBLIC_IP>
A    dev-app       <STATIC_PUBLIC_IP>
A    dev-admin     <STATIC_PUBLIC_IP>
A    monitor       <STATIC_PUBLIC_IP>
A    ssh           <STATIC_PUBLIC_IP>
```

DNS does not store the SSH port in a way the standard SSH client automatically uses.

SSH access would therefore remain:

```bash
ssh -p 52222 beonedge@ssh.beonedge.in
```

or:

```bash
ssh -p 52222 beonedge@beonedge.in
```

---

# 7. Same-Origin Web Architecture

## 7.1 Production user application

The production user frontend will be served from:

```text
https://app.beonedge.in/
```

The frontend should call the backend using a relative URL:

```text
/api
```

Examples:

```text
GET  /api/auth/status
GET  /api/portfolio
POST /api/investments
WS   /ws
```

Nginx will route requests as follows:

```text
https://app.beonedge.in/        → Production user frontend
https://app.beonedge.in/api/    → Production backend
https://app.beonedge.in/ws/     → Production backend WebSocket
```

From the browser's perspective, both the page and API belong to:

```text
Scheme: https
Host:   app.beonedge.in
Port:   443
```

This makes the frontend API communication same-origin.

Benefits include:

* Minimal CORS requirements
* Simpler cookie management
* Easier CSRF protection
* No separate public backend port
* Cleaner production URLs
* Easier WebSocket configuration
* Reduced exposure of backend implementation details

---

## 7.2 Production administrator application

The production administrator frontend will be served from:

```text
https://admin.beonedge.in/
```

Its API requests should also use:

```text
/api
```

Nginx routing:

```text
https://admin.beonedge.in/       → Production admin frontend
https://admin.beonedge.in/api/   → Same production backend
https://admin.beonedge.in/ws/    → Same production backend WebSocket
```

The administrator frontend and user frontend can share the same backend, but server-side authorization must remain authoritative.

The backend must never assume that a request is administrative merely because it came through `admin.beonedge.in`.

Every administrative endpoint must verify:

* Valid authenticated identity
* User account status
* Administrator role
* Required permission
* Session or token validity
* CSRF protection where cookies are used

---

## 7.3 Development stack

The development user frontend will use:

```text
https://dev-app.beonedge.in/
```

Routing:

```text
https://dev-app.beonedge.in/       → Development user frontend
https://dev-app.beonedge.in/api/   → Development backend
https://dev-app.beonedge.in/ws/    → Development backend WebSocket
```

The development administrator frontend will use:

```text
https://dev-admin.beonedge.in/
```

Routing:

```text
https://dev-admin.beonedge.in/       → Development admin frontend
https://dev-admin.beonedge.in/api/   → Same development backend
https://dev-admin.beonedge.in/ws/    → Same development backend WebSocket
```

Development and production must not share:

* Database containers
* Database volumes
* Docker networks
* Session signing secrets
* API signing secrets
* Encryption keys
* Cookie names
* Application container names
* Backend ports
* Frontend ports
* Administrator session cookies

---

# 8. Port Reservation Plan

Actual port numbers will be selected manually after confirming that they are unused.

The chosen values should be recorded in one central document or environment file.

## 8.1 Public host ports

| Variable            | Binding          | Purpose                                |
| ------------------- | ---------------- | -------------------------------------- |
| `NGINX_HTTP_PORT`   | `0.0.0.0:<PORT>` | Public HTTP and certificate validation |
| `NGINX_HTTPS_PORT`  | `0.0.0.0:<PORT>` | Public HTTPS                           |
| `SSH_INTERNAL_PORT` | VPS `<PORT>`     | Internal OpenSSH listener              |

Normally:

```text
NGINX_HTTP_PORT  = 80
NGINX_HTTPS_PORT = 443
SSH_INTERNAL_PORT = 22
```

The router maps external `52222` to the VPS SSH port.

---

## 8.2 Production service ports

| Variable                   | Recommended binding | Service                   |
| -------------------------- | ------------------- | ------------------------- |
| `PROD_LANDING_PORT`        | `127.0.0.1:<PORT>`  | Landing frontend          |
| `PROD_APP_FRONTEND_PORT`   | `127.0.0.1:<PORT>`  | User frontend             |
| `PROD_ADMIN_FRONTEND_PORT` | `127.0.0.1:<PORT>`  | Admin frontend            |
| `PROD_BACKEND_PORT`        | `127.0.0.1:<PORT>`  | Shared production backend |
| `PROD_POSTGRES_PORT`       | No host binding     | Production PostgreSQL     |

---

## 8.3 Development service ports

| Variable                  | Recommended binding | Service                    |
| ------------------------- | ------------------- | -------------------------- |
| `DEV_APP_FRONTEND_PORT`   | `127.0.0.1:<PORT>`  | Development user frontend  |
| `DEV_ADMIN_FRONTEND_PORT` | `127.0.0.1:<PORT>`  | Development admin frontend |
| `DEV_BACKEND_PORT`        | `127.0.0.1:<PORT>`  | Shared development backend |
| `DEV_POSTGRES_PORT`       | No host binding     | Development PostgreSQL     |

---

## 8.4 Monitoring service ports

Only the monitoring interface that Nginx must access needs a host port.

| Variable                 | Recommended exposure                | Purpose                       |
| ------------------------ | ----------------------------------- | ----------------------------- |
| `GRAFANA_PORT`           | `127.0.0.1:<PORT>`                  | Grafana UI                    |
| `MONITOR_APP_PORT`       | `127.0.0.1:<PORT>`                  | Optional custom monitoring UI |
| `MONITOR_API_PORT`       | `127.0.0.1:<PORT>` or internal only | Optional monitoring backend   |
| `PROMETHEUS_PORT`        | Internal Docker network preferred   | Prometheus                    |
| `ALERTMANAGER_PORT`      | Internal Docker network preferred   | Alertmanager                  |
| `CADVISOR_PORT`          | Internal Docker network preferred   | Container metrics             |
| `NODE_EXPORTER_PORT`     | Localhost or monitoring network     | Host metrics                  |
| `POSTGRES_EXPORTER_PORT` | Internal monitoring network         | Database metrics              |

Prometheus, exporters, and Alertmanager should not be directly available from the internet.

---

## 8.5 Checking whether a port is available

Before assigning a port:

```bash
sudo ss -lntup
```

Check one specific port:

```bash
sudo ss -lntup | grep ':<PORT>'
```

Alternative:

```bash
sudo lsof -i :<PORT>
```

The selected values should be recorded in:

```text
/srv/dev_stack/BOE_APP/README.md
```

and in the environment-specific configuration used by Docker Compose and Nginx.

---

# 9. Docker Compose Network Design

## 9.1 Production networks

The production Compose stack should have separate frontend and internal networks.

Conceptual example:

```yaml
services:
  prod_app_frontend:
    image: boe-prod-app-frontend:<VERSION>
    ports:
      - "127.0.0.1:${PROD_APP_FRONTEND_PORT}:3000"
    networks:
      - prod_frontend
    restart: unless-stopped

  prod_admin_frontend:
    image: boe-prod-admin-frontend:<VERSION>
    ports:
      - "127.0.0.1:${PROD_ADMIN_FRONTEND_PORT}:3000"
    networks:
      - prod_frontend
    restart: unless-stopped

  prod_backend:
    image: boe-prod-backend:<VERSION>
    ports:
      - "127.0.0.1:${PROD_BACKEND_PORT}:8000"
    networks:
      - prod_frontend
      - prod_internal
    restart: unless-stopped

  prod_postgres:
    image: postgres:<PINNED_VERSION>
    networks:
      - prod_internal
    volumes:
      - prod_postgres_data:/var/lib/postgresql/data
    restart: unless-stopped

networks:
  prod_frontend:
  prod_internal:
    internal: true

volumes:
  prod_postgres_data:
```

The PostgreSQL service has no `ports:` entry.

The backend connects to PostgreSQL through its Docker service name:

```text
prod_postgres:5432
```

---

## 9.2 Development networks

Development must use independent networks and volumes:

```yaml
networks:
  dev_frontend:
  dev_internal:
    internal: true

volumes:
  dev_postgres_data:
```

A development container should never join a production Docker network.

---

## 9.3 Container security settings

Where compatible, containers should use:

```yaml
security_opt:
  - no-new-privileges:true

cap_drop:
  - ALL
```

Additional protections where supported:

```yaml
read_only: true

tmpfs:
  - /tmp

pids_limit: 200

mem_limit: <LIMIT>

cpus: <LIMIT>
```

Application containers should run as non-root users inside their images.

Database containers require writable storage and should not be made read-only.

Image versions should be pinned:

```yaml
image: boe-prod-backend:1.4.2
```

Avoid relying only on:

```yaml
image: boe-prod-backend:latest
```

---

# 10. Nginx Reverse Proxy Design

Nginx will be installed and managed directly on the VPS host.

The Docker frontend and backend services will bind only to `127.0.0.1`, allowing Nginx to reach them without exposing them through the network interface.

## 10.1 Global WebSocket mapping

Place this in the Nginx `http` context:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
```

---

## 10.2 Production application configuration

Example:

```nginx
server {
    listen 80;
    listen [::]:80;

    server_name app.beonedge.in;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;

    server_name app.beonedge.in;

    ssl_certificate     /etc/letsencrypt/live/app.beonedge.in/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/app.beonedge.in/privkey.pem;

    client_max_body_size 10m;

    location /api/ {
        proxy_pass http://127.0.0.1:<PROD_BACKEND_PORT>;

        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;

        proxy_connect_timeout 10s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;

        proxy_buffering off;
    }

    location /ws/ {
        proxy_pass http://127.0.0.1:<PROD_BACKEND_PORT>;

        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    location / {
        proxy_pass http://127.0.0.1:<PROD_APP_FRONTEND_PORT>;

        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
    }
}
```

Using:

```nginx
proxy_pass http://127.0.0.1:<PROD_BACKEND_PORT>;
```

without a trailing URI preserves the `/api/...` path.

The backend must therefore expose routes matching the path Nginx forwards.

---

## 10.3 Production admin configuration

```nginx
server {
    listen 80;
    listen [::]:80;

    server_name admin.beonedge.in;

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;

    server_name admin.beonedge.in;

    ssl_certificate     /etc/letsencrypt/live/admin.beonedge.in/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/admin.beonedge.in/privkey.pem;

    client_max_body_size 10m;

    location /api/ {
        proxy_pass http://127.0.0.1:<PROD_BACKEND_PORT>;

        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;

        proxy_buffering off;
    }

    location /ws/ {
        proxy_pass http://127.0.0.1:<PROD_BACKEND_PORT>;

        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_read_timeout 3600s;
    }

    location / {
        proxy_pass http://127.0.0.1:<PROD_ADMIN_FRONTEND_PORT>;

        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## 10.4 Development domains

The same structure will be used for:

```text
dev-app.beonedge.in
dev-admin.beonedge.in
```

The only differences are:

* Development frontend ports
* Development backend port
* Development TLS certificate
* Development security restrictions
* Development cookie names
* Development authentication secrets

---

# 11. Protecting the Development Stack

The development environment is intended for a small number of testers.

It should not rely only on the application's normal login page.

Recommended protection layers:

1. HTTPS
2. Application authentication
3. Separate development accounts
4. Nginx Basic Authentication or another reverse-proxy access layer
5. Rate limiting
6. `robots.txt` disallow rules
7. `X-Robots-Tag: noindex, nofollow`
8. No production customer data
9. Separate database
10. Separate secrets

Example Nginx development restriction:

```nginx
auth_basic "BeOnEdge Development";
auth_basic_user_file /etc/nginx/auth/dev-testers.htpasswd;

add_header X-Robots-Tag "noindex, nofollow, noarchive" always;
```

A stronger future configuration would make the development and monitoring domains accessible only through Tailscale.

For the first implementation, HTTPS plus reverse-proxy authentication and application authentication provides a practical controlled-access model.

---

# 12. HTTPS and Certificate Configuration

## 12.1 Router forwarding

The following TCP port-forwarding rules are required:

```text
Public TCP 80  → VPS_LAN_IP:80
Public TCP 443 → VPS_LAN_IP:443
```

Port `80` is required for normal HTTP certificate validation and HTTP-to-HTTPS redirection.

Port `443` serves the application over HTTPS.

## 12.2 Certificate strategy

The simplest certificate strategy is to issue certificates for each hostname.

Examples:

```bash
sudo certbot --nginx \
  -d beonedge.in \
  -d www.beonedge.in
```

```bash
sudo certbot --nginx \
  -d app.beonedge.in
```

```bash
sudo certbot --nginx \
  -d admin.beonedge.in
```

```bash
sudo certbot --nginx \
  -d dev-app.beonedge.in \
  -d dev-admin.beonedge.in
```

```bash
sudo certbot --nginx \
  -d monitor.beonedge.in
```

A wildcard certificate such as:

```text
*.beonedge.in
```

usually requires DNS-based validation. It is not required for the initial architecture.

## 12.3 Certificate renewal

The renewal timer must be enabled and tested:

```bash
systemctl status certbot.timer
```

Test renewal:

```bash
sudo certbot renew --dry-run
```

The monitoring service should alert when a certificate is approaching expiration.

---

# 13. Nginx Security Headers

Security headers should be introduced carefully.

A reusable Nginx include may contain:

```nginx
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
```

A Content Security Policy should be tailored to the actual frontend assets and integrations.

Do not blindly enable a restrictive CSP before checking:

* JavaScript bundles
* API paths
* WebSocket paths
* Analytics
* Charting libraries
* External fonts
* Payment integrations
* Image sources

HSTS may eventually be enabled:

```nginx
add_header Strict-Transport-Security "max-age=31536000" always;
```

Do not use `includeSubDomains` until every required subdomain works permanently over HTTPS.

---

# 14. Rate Limiting

Nginx should provide basic rate limiting for sensitive endpoints.

Example global zones:

```nginx
limit_req_zone $binary_remote_addr zone=general_api:10m rate=20r/s;
limit_req_zone $binary_remote_addr zone=auth_api:10m rate=5r/m;
```

Example usage:

```nginx
location /api/auth/login {
    limit_req zone=auth_api burst=5 nodelay;

    proxy_pass http://127.0.0.1:<PROD_BACKEND_PORT>;
}
```

```nginx
location /api/ {
    limit_req zone=general_api burst=40 nodelay;

    proxy_pass http://127.0.0.1:<PROD_BACKEND_PORT>;
}
```

Application-level rate limits should still exist for:

* Login
* Password reset
* OTP requests
* Registration
* Investment requests
* Administrative operations
* File uploads
* Expensive reporting queries

---

# 15. Web Authentication Security

## 15.1 Cookie-based web sessions

For the web application, cookies should be:

```text
Secure
HttpOnly
SameSite=Lax or SameSite=Strict
Path=/
```

Production and development must use different cookie names.

Example:

```text
Production: boe_prod_session
Development: boe_dev_session
Admin:      boe_admin_session
```

Avoid setting:

```text
Domain=.beonedge.in
```

unless sharing a cookie across subdomains is an explicit requirement.

Host-only cookies provide better isolation.

## 15.2 CSRF protection

Any state-changing API using cookie authentication must implement CSRF protection.

Examples of state-changing requests include:

* Investment creation
* Redemption
* Profile changes
* Password changes
* Administrator approval
* Fund-pool modification
* AUM changes
* User activation or deactivation

## 15.3 Backend authorization

The backend must verify authorization for every protected operation.

Frontend visibility controls are not security controls.

For example, hiding an admin button does not prevent a non-admin user from manually calling the endpoint.

The backend must validate:

* User identity
* Account state
* Role
* Permission
* Ownership of the requested object
* Request integrity
* Session age
* Re-authentication requirements for sensitive actions

---

# 16. Android APK Architecture

The frontend will be converted into Android applications using Gradle and Capacitor.

There will be two separate APK variants:

1. Development APK
2. Production release APK

Both applications should be installable on the same Android device simultaneously.

---

## 16.1 Package identities

Recommended package identities:

```text
Production:
in.beonedge.app

Development:
in.beonedge.app.dev
```

Display names:

```text
Production:
BeOnEdge

Development:
BeOnEdge Dev
```

The development APK should have a visibly different name and icon so testers do not confuse it with production.

---

## 16.2 Gradle product flavors

Conceptual Gradle structure:

```gradle
android {
    namespace "in.beonedge.app"

    defaultConfig {
        applicationId "in.beonedge.app"
    }

    flavorDimensions += "environment"

    productFlavors {
        dev {
            dimension "environment"
            applicationIdSuffix ".dev"
            versionNameSuffix "-dev"

            buildConfigField(
                "String",
                "API_BASE_URL",
                "\"https://dev-app.beonedge.in/api\""
            )

            buildConfigField(
                "String",
                "WS_BASE_URL",
                "\"wss://dev-app.beonedge.in/ws\""
            )
        }

        prod {
            dimension "environment"

            buildConfigField(
                "String",
                "API_BASE_URL",
                "\"https://app.beonedge.in/api\""
            )

            buildConfigField(
                "String",
                "WS_BASE_URL",
                "\"wss://app.beonedge.in/ws\""
            )
        }
    }
}
```

The exact values may be injected through build-time environment files instead of being manually duplicated.

---

## 16.3 Capacitor production behavior

The production APK should bundle the frontend files inside the application.

The production build should not use Capacitor live-reload configuration.

Do not permanently configure production with a remote development server such as:

```text
server.url = http://development-machine:port
```

That configuration is suitable only for local development and live reload.

The final production APK should:

* Bundle its frontend
* Call only HTTPS APIs
* Use `wss://` for WebSockets
* Reject cleartext HTTP
* Use the production backend
* Use production application identifiers
* Use the production signing key

---

## 16.4 APK API routing

Production APK:

```text
HTTPS API:
https://app.beonedge.in/api

Secure WebSocket:
wss://app.beonedge.in/ws
```

Development APK:

```text
HTTPS API:
https://dev-app.beonedge.in/api

Secure WebSocket:
wss://dev-app.beonedge.in/ws
```

Nginx routes these requests to the correct backend ports.

---

## 16.5 Same-origin difference for Capacitor

The web browser frontend can use same-origin relative paths such as:

```text
/api
```

A bundled Capacitor application may internally run under an origin such as:

```text
capacitor://localhost
```

or:

```text
http://localhost
```

Therefore, ordinary WebView `fetch` requests to:

```text
https://app.beonedge.in/api
```

may be treated as cross-origin.

There are two valid approaches.

### Approach A: Native Capacitor HTTP transport

Use native Android networking through the Capacitor HTTP layer.

Advantages:

* Browser CORS restrictions do not apply in the same manner
* Native networking behavior
* Direct HTTPS API communication

Authentication should use tokens in the `Authorization` header.

### Approach B: WebView fetch with strict CORS

Allow only the exact required Capacitor origins.

Possible allowed origins may include:

```text
capacitor://localhost
http://localhost
https://localhost
```

The actual origin used by the final application must be confirmed before production.

Never use:

```text
Access-Control-Allow-Origin: *
```

together with credentials or sensitive authenticated endpoints.

The backend should maintain separate allowed-origin lists for development and production.

---

## 16.6 APK authentication

The mobile application should preferably use:

```text
Authorization: Bearer <ACCESS_TOKEN>
```

Recommended token structure:

* Short-lived access token
* Rotating refresh token
* Refresh token revocation
* Device-session tracking
* Logout invalidation
* Server-side account deactivation
* Re-authentication for sensitive operations

Tokens must not be stored in:

* Plain localStorage
* Plain text files
* Frontend source files
* Public application preferences

Long-lived mobile credentials should use Android Keystore-backed secure storage.

---

## 16.7 APK signing

Production and development builds should have separate signing handling.

Production signing keys must:

* Never be stored in Git
* Never be transferred to the VPS
* Be backed up securely
* Be password protected
* Be stored offline when not used
* Have access limited to the release operator

The VPS should receive the signed APK, not the signing key.

The APK release directories should contain:

```text
APK file
Version metadata
SHA-256 checksum
Build timestamp
Source commit identifier
Environment identifier
```

---

## 16.8 Android network security

The release application should disable cleartext network traffic.

Conceptually:

```xml
<application
    android:usesCleartextTraffic="false">
</application>
```

The application must not silently fall back from HTTPS to HTTP.

Development APK traffic should also use valid HTTPS certificates. Self-signed certificates should not be required for the normal tester build.

---

# 17. Deployment Artifact Design

## 17.1 Image files

The image directory may contain:

```text
images/
├── backend.tar.gz
├── frontend.tar.gz
└── admin-frontend.tar.gz
```

The images should be produced using `docker save`.

Example:

```bash
docker save "boe-backend:${VERSION}" \
    | gzip > backend.tar.gz
```

Equivalent commands will be used for the frontend and admin frontend.

The image names and tags inside the archives must be explicit and versioned.

Recommended:

```text
boe-prod-backend:1.4.2
boe-prod-frontend:1.4.2
boe-prod-admin-frontend:1.4.2
```

Development:

```text
boe-dev-backend:1.4.2-dev
boe-dev-frontend:1.4.2-dev
boe-dev-admin-frontend:1.4.2-dev
```

---

## 17.2 Checksums

Each release should include checksums:

```bash
sha256sum \
    images/backend.tar.gz \
    images/frontend.tar.gz \
    images/admin-frontend.tar.gz \
    > checksums.sha256
```

The deployment script must verify them before loading the images:

```bash
sha256sum -c checksums.sha256
```

A checksum failure must stop deployment immediately.

---

## 17.3 Version file

Example production version state:

```json
{
  "environment": "production",
  "version": "1.4.2",
  "previous_version": "1.4.1",
  "deployed_at": "2026-07-30T20:00:00+05:30",
  "status": "active",
  "images": {
    "backend": "boe-prod-backend:1.4.2",
    "frontend": "boe-prod-frontend:1.4.2",
    "admin_frontend": "boe-prod-admin-frontend:1.4.2"
  },
  "database_schema_version": 12
}
```

The version file should be updated only after:

* Containers start
* Health checks pass
* Backend smoke tests pass
* Frontend reachability passes
* Required migrations complete
* The deployment is considered active

Version-file updates should be atomic.

Example:

```bash
jq \
  --arg version "$NEW_VERSION" \
  '.version = $version' \
  release-version.json > release-version.json.tmp

jq empty release-version.json.tmp

mv release-version.json.tmp release-version.json
```

---

# 18. Production Deployment Flow

The production deployment script should perform the following sequence:

```text
1. Acquire exclusive deployment lock
2. Verify the release directory
3. Verify backup-drive mount
4. Check available disk space
5. Read currently deployed version
6. Validate incoming release version
7. Verify SHA-256 checksums
8. Verify Docker Compose syntax
9. Verify required environment files
10. Create versioned rollback directory
11. Save current Docker images with docker save
12. Copy current APK into rollback storage
13. Create pre-deployment PostgreSQL backup
14. Load new Docker images
15. Run backward-compatible database migrations
16. Start or update Docker Compose stack
17. Wait for container health checks
18. Test backend health endpoint
19. Test frontend route
20. Test admin route
21. Test WebSocket connection where practical
22. Atomically update release-version.json
23. Write successful deployment log
24. Apply artifact-retention policy
25. Release deployment lock
```

The production and rollback scripts must use the same lock.

Example:

```bash
LOCK_FILE="/run/lock/boe-prod-release.lock"

exec 9>"$LOCK_FILE"

if ! flock -n 9; then
    echo "Another production deployment or rollback is running."
    exit 1
fi
```

---

# 19. Rollback Storage

When the active version is `v1.4.2`, the deployment script may create:

```text
/srv/backup/BOE_APP/PROD_ROLLBACK/IMAGES/v1.4.2/
├── backend.tar.gz
├── frontend.tar.gz
├── admin-frontend.tar.gz
├── docker-compose.prod_app.yml
├── release-version.json
└── checksums.sha256
```

APK rollback:

```text
/srv/backup/BOE_APP/PROD_ROLLBACK/APK/v1.4.2/
├── beonedge-v1.4.2.apk
├── apk-version.json
└── checksums.sha256
```

Version-specific pre-deployment database snapshot:

```text
/srv/backup/BOE_APP/PROD_ROLLBACK/PSQL_DB/v1.4.2/
├── pre-deploy.dump
├── backup-metadata.json
└── checksums.sha256
```

The equivalent structure applies to development.

---

# 20. Application and Database Rollback

Application rollback and database restoration must remain separate operations.

## 20.1 Application rollback

Application rollback means:

```text
New backend/frontend images
        ↓
Previous backend/frontend images
```

Typical flow:

```text
1. Acquire lock
2. Validate rollback version
3. Verify rollback checksums
4. Verify database schema compatibility
5. Preserve current images if required
6. Load selected rollback images
7. Update Docker Compose image references
8. Start the selected version
9. Run health checks
10. Atomically update version file
11. Record rollback event
```

## 20.2 Database restoration

Database restoration means:

```text
Current production database
        ↓
Older database state
```

This may discard valid transactions created after the backup.

Database restoration must therefore be:

* Explicit
* Separately logged
* Performed only when required
* Protected by confirmation or an emergency procedure
* Preceded by a backup of the current database
* Followed by integrity checks

A failed application deployment should normally trigger application rollback, not automatic database restoration.

---

# 21. Database Migration Strategy

Database migrations should use an expand-and-contract approach.

Example:

1. Add new tables or nullable columns.
2. Keep old columns temporarily.
3. Deploy backend compatible with both schemas.
4. Migrate existing data.
5. Confirm stability.
6. Remove deprecated columns in a later release.

This makes application rollback safer.

Release metadata should record the expected schema version.

Example:

```json
{
  "version": "1.4.2",
  "database": {
    "required_schema": 12,
    "compatible_schema_min": 11,
    "compatible_schema_max": 13
  }
}
```

Before rollback, the rollback script should compare the current schema version with the selected backend's compatibility range.

---

# 22. Secret Management

Secrets should not be stored inside release bundles or image archives. Each
stack keeps its sole authoritative `.env` directly in its VPS stack directory;
release shipping excludes these files.

Recommended host storage:

```text
/srv/dev_stack/BOE_APP/
├── prod_release/.env
├── dev_release/.env
└── monitor_service/.env
```

Permissions:

```bash
chmod 600 /srv/dev_stack/BOE_APP/{prod_release,dev_release,monitor_service}/.env
```

Secrets include:

* PostgreSQL passwords
* Session signing keys
* JWT signing keys
* Encryption keys
* SMTP credentials
* Monitoring alert credentials
* Backup-encryption keys
* Third-party API credentials
* Payment integration secrets

Production and development secrets must be different.

Docker image builds must not include `.env` files in image layers.

---

# 23. SSH Security

Current SSH design:

```text
Public TCP 52222
        ↓
Router forwarding
        ↓
VPS TCP 22
        ↓
OpenSSH private-key authentication
```

Disabling password login is correct.

Recommended SSH server settings:

```text
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
MaxAuthTries 3
LoginGraceTime 30
X11Forwarding no
AllowTcpForwarding yes or no depending on actual need
```

Restrict permitted users:

```text
AllowUsers beonedge prakash
```

Only include users who require SSH access.

The nonstandard external port reduces automated noise but is not a replacement for authentication security.

Additional protections:

* Install and configure Fail2ban
* Keep OpenSSH updated
* Remove unused authorized keys
* Use separate keys per user and device
* Never share one private key between team members
* Add a key comment identifying the device
* Revoke lost-device keys immediately
* Disable inactive accounts
* Review `/var/log/auth.log`
* Consider Tailscale-only SSH later

Example SSH command:

```bash
ssh -p 52222 beonedge@ssh.beonedge.in
```

---

# 24. VPS Firewall

Recommended UFW policy:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
```

Allow OpenSSH on the VPS internal port:

```bash
sudo ufw allow 22/tcp
```

The router performs the external `52222` to internal `22` translation. UFW therefore sees traffic arriving on port `22`.

Allow HTTP and HTTPS:

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

Enable the firewall:

```bash
sudo ufw enable
```

Review:

```bash
sudo ufw status verbose
```

No Docker application service should publish to `0.0.0.0`.

Use either:

```yaml
ports:
  - "127.0.0.1:<HOST_PORT>:<CONTAINER_PORT>"
```

or no host binding.

Docker-published public ports can bypass assumptions made only at the UFW layer, so binding explicitly to `127.0.0.1` is important.

---

# 25. Monitoring Service Responsibilities

The monitoring service will be responsible for five primary areas:

1. Infrastructure monitoring
2. Application monitoring
3. Database monitoring
4. Backup management
5. Alerts and operational reporting

---

## 25.1 Monitoring components

Recommended initial components:

### Prometheus

Collects and stores metrics.

### Grafana

Provides dashboards and visualisation.

### Alertmanager

Routes alerts to configured channels.

### Node Exporter

Reports:

* CPU usage
* Memory usage
* Load average
* Disk usage
* Disk I/O
* Network traffic
* Filesystem status
* Inode usage

### cAdvisor

Reports container-level metrics:

* Container CPU
* Container memory
* Restarts
* Network I/O
* Block I/O
* Container state

### PostgreSQL Exporter

Reports:

* Database availability
* Connections
* Transaction rate
* Locking
* Long-running queries
* Database size
* Replication or WAL state
* Cache and tuple statistics

Production and development databases should use separate exporter credentials with monitoring-only permissions.

### Nginx metrics exporter

Reports:

* Request counts
* Active connections
* Response status categories
* Request rate
* Nginx availability

### Blackbox Exporter

Tests the application externally:

* HTTPS availability
* DNS resolution
* TLS validity
* Response time
* HTTP response status
* Certificate expiry

### Application metrics endpoint

The backend should expose an internal metrics endpoint such as:

```text
/metrics
```

It should contain metrics such as:

* API request count
* API latency
* Authentication failures
* Active WebSocket connections
* Database query latency
* Background-task failures
* User registration count
* Investment-operation failures
* Internal error count

The metrics endpoint should not be exposed publicly without protection.

---

# 26. Monitoring Network Exposure

Only Grafana or the custom monitoring frontend should normally have a localhost host binding.

Example:

```yaml
grafana:
  ports:
    - "127.0.0.1:${GRAFANA_PORT}:3000"
```

Prometheus should communicate with exporters through the monitoring Docker network.

Example:

```yaml
networks:
  monitor_internal:
    internal: true
```

Prometheus, Alertmanager, cAdvisor, and database exporters should not be publicly accessible.

Nginx will expose only:

```text
https://monitor.beonedge.in
```

This domain should be restricted more strongly than the public application.

Recommended controls:

* Tailscale-only access when practical
* Nginx Basic Authentication
* Grafana authentication
* No anonymous Grafana access
* Strong administrator passwords
* Limited administrator accounts
* HTTPS only
* Rate limiting
* Session timeout
* Audit logs

---

# 27. Grafana Dashboards

Recommended dashboards:

## 27.1 VPS overview

* CPU usage
* Load average
* RAM usage
* Swap usage
* Disk usage
* Inode usage
* Disk latency
* Network traffic
* Uptime

## 27.2 Production application

* Frontend availability
* Backend availability
* API latency
* HTTP error rate
* WebSocket connections
* Container resource consumption
* Container restarts
* Current release version

## 27.3 Development application

* Development stack state
* API latency
* Tester activity
* Container restarts
* Current development version
* Development database size

## 27.4 PostgreSQL

* Database uptime
* Active connections
* Connection-pool usage
* Transaction rate
* Slow queries
* Lock waits
* Deadlocks
* Database size
* WAL generation
* Backup status

## 27.5 Nginx and TLS

* HTTP request rate
* `2xx`, `4xx`, and `5xx` counts
* Upstream response time
* Failed upstream requests
* Certificate expiry
* Domain reachability

## 27.6 Backup dashboard

* Last successful production backup
* Last successful development backup
* Backup duration
* Backup size
* Backup checksum status
* Last restore test
* Available backup-disk space
* Backup failure count

## 27.7 Deployment dashboard

* Production version
* Development version
* Monitoring stack version
* Last deployment time
* Last rollback time
* Deployment result
* Deployment duration
* Operator identity where recorded

---

# 28. Dedicated Monitoring Application

Grafana will serve as the first dedicated monitoring application.

It already provides:

* Dashboards
* Queries
* Alert visualisation
* Historical metrics
* User authentication
* Annotation support
* Data-source management

A custom BeOnEdge monitoring application may later be added for simplified operational control.

Recommended architecture:

```text
Custom monitoring frontend
        │
        ▼
Read-only monitoring API
        │
        ├── Reads Prometheus
        ├── Reads deployment version JSON files
        ├── Reads backup status metadata
        ├── Reads health-check state
        └── Reads sanitized deployment logs
```

The custom monitoring application should not query production PostgreSQL directly for infrastructure information.

It should not receive unrestricted Docker control.

Recommended custom monitoring screens:

* Overall system status
* Production health
* Development health
* Current release versions
* Backup status
* Disk status
* Certificate status
* Active alerts
* Deployment history
* Rollback history
* Service restart history
* Database health summary

Grafana should remain available for deeper diagnostics even after the custom monitoring application is created.

---

# 29. Monitoring Alerts

Recommended critical alerts:

* Production backend unavailable
* Production frontend unavailable
* Production administrator frontend unavailable
* PostgreSQL unavailable
* Container restart loop
* Disk usage above threshold
* Backup disk not mounted
* Backup failed
* Restore verification failed
* Certificate close to expiration
* High API error rate
* Sustained high CPU
* Sustained high memory usage
* Database connection exhaustion
* PostgreSQL deadlock
* Abnormally high authentication failures
* Nginx `5xx` spike

Recommended warning alerts:

* Development stack unavailable while expected to be active
* Increasing API latency
* Backup duration unusually high
* Backup size unexpectedly small
* Disk usage growing rapidly
* Certificate renewal test failure
* Application version mismatch
* Monitoring scrape failure

Alert channels may include:

* Email
* Telegram
* Slack
* Another internal notification service

Sensitive information must not be included in alert messages.

---

# 30. Database Backup Responsibilities

The monitoring system will manage backups for both development and production PostgreSQL databases.

PostgreSQL will remain an internal Docker service with no host binding.

Backup commands may be executed using:

```bash
docker compose \
  -f /srv/dev_stack/BOE_APP/prod_release/docker-compose.prod_app.yml \
  exec -T prod_postgres \
  pg_dump ...
```

The same pattern applies to development.

---

## 30.1 Backup execution location

For security, backup scheduling should preferably use root-owned host scripts and systemd timers.

This avoids giving a monitoring container unrestricted access to:

```text
/var/run/docker.sock
```

Mounting the Docker socket into a container effectively gives that container powerful control over the host.

Recommended design:

```text
monitor_service/
├── Docker monitoring stack
├── Grafana
├── Prometheus
├── Alertmanager
└── Host-managed backup scripts
```

The backup scripts can still logically belong to the monitoring service even when executed by systemd on the host.

---

## 30.2 Backup types

### Development backups

Recommended:

* Daily backup only when development database is active
* Backup before development database migrations
* Backup before destructive testing
* Shorter retention period

### Production backups

Recommended:

* Scheduled logical backup
* Backup before every production deployment involving migrations
* Backup before significant administrative database operations
* Longer retention
* Periodic restore testing

For near-continuous recovery, PostgreSQL WAL archiving can be added later.

The monitor service should not run a complete `pg_dump` after every database row insertion.

PostgreSQL already records changes through its write-ahead log. Near-continuous protection should use WAL-based recovery rather than repeatedly dumping the complete database.

---

## 30.3 Backup naming

Example:

```text
prod_boe_2026-07-30T203000_v1.4.2_schema12.dump
```

Development:

```text
dev_boe_2026-07-30T203000_v1.5.0-dev_schema13.dump
```

Backup metadata:

```json
{
  "environment": "production",
  "database": "boe_app",
  "created_at": "2026-07-30T20:30:00+05:30",
  "application_version": "1.4.2",
  "schema_version": 12,
  "backup_type": "scheduled",
  "status": "complete",
  "sha256": "<CHECKSUM>",
  "size_bytes": 123456789
}
```

---

# 31. Scheduled Backup and Rollback Backup Separation

Version-coupled database snapshots can remain in:

```text
PROD_ROLLBACK/PSQL_DB/<VERSION>/
DEV_ROLLBACK/DEV_PSQL_DB/<VERSION>/
```

These are associated with application deployments.

Regular scheduled backups should ideally use a separate location:

```text
/srv/backup/BOE_APP/DB_BACKUPS/
├── PROD
│   ├── DAILY
│   ├── WEEKLY
│   └── MONTHLY
└── DEV
    ├── DAILY
    └── MANUAL
```

This separates:

* Release rollback snapshots
* Scheduled operational backups
* Emergency manual backups
* Long-term retention backups

`DBS_ROLLBACK` may be retained for explicitly created emergency restore points.

---

# 32. Backup Safety Checks

Before writing any backup:

```bash
mountpoint -q /srv/backup
```

If `/srv/backup` is not mounted, the backup process must stop.

Without this check, backups may accidentally be written to the root filesystem under an unmounted directory.

Also verify:

* Available disk space
* Available inodes
* Database connectivity
* Backup command exit code
* Final file size
* SHA-256 checksum
* Metadata creation
* File ownership and permissions

Example backup permissions:

```bash
chmod 600 <BACKUP_FILE>
```

Backup logs should not expose passwords or database connection strings.

---

# 33. Backup Retention

Example initial retention policy:

## Production

* Keep daily backups for 14 days
* Keep weekly backups for 8 weeks
* Keep monthly backups for 6 months
* Keep the latest pre-deployment backup
* Keep database backups tied to retained rollback releases
* Never delete the active or immediately previous release backup automatically

## Development

* Keep daily backups for 7 days
* Keep the latest three pre-deployment backups
* Delete obsolete test backups more aggressively

Retention should be based on:

* Backup age
* Backup class
* Available disk space
* Release retention
* Restore requirements

Deletion must be logged.

---

# 34. Restore Testing

A backup is not considered reliable until it has been restored successfully.

The monitoring system should periodically:

1. Create a disposable PostgreSQL container.
2. Create an empty test database.
3. Restore the selected backup.
4. Verify expected tables.
5. Verify migration version.
6. Run consistency checks.
7. Record the result.
8. Delete the disposable environment.

The monitoring dashboard should display:

```text
Last backup: successful
Last restore test: successful
Last restore test time: <TIMESTAMP>
```

---

# 35. Off-Server Backup

The `/srv/backup` drive protects against:

* Failed deployment
* Accidental deletion
* Individual disk failure
* Recent database corruption
* Incorrect migration

It does not fully protect against:

* Entire server theft
* Fire
* Electrical damage
* Ransomware
* Full host compromise
* Accidental destruction of both storage locations

Production backups should eventually be copied to a separate physical or remote location.

The off-server copy should be:

* Encrypted before transfer
* Checksum verified
* Access controlled
* Retention managed
* Periodically restored and tested

This can remain a later infrastructure phase.

---

# 36. Log Management

Logs should be separated by environment and service.

Recommended categories:

```text
/srv/backup/BOE_APP/LOGS/
├── DEV_LOGS
│   ├── DEV_IMAGE_LOGS
│   ├── DEV_PSQL_DB_LOGS
│   ├── DEV_DEPLOY_LOGS
│   └── DEV_APP_LOGS
├── PROD_LOGS
│   ├── IMAGE_LOGS
│   ├── PSQL_DB_LOGS
│   ├── DEPLOY_LOGS
│   └── APP_LOGS
└── MONITOR_LOGS
    ├── BACKUP_LOGS
    ├── ALERT_LOGS
    └── RESTORE_TEST_LOGS
```

Logs should contain:

* Timestamp
* Environment
* Version
* Script
* Operation
* Result
* Error message
* Duration
* Operator where applicable

Logs must not contain:

* Passwords
* Access tokens
* Refresh tokens
* Private keys
* Full financial data
* Sensitive user data
* Database connection secrets

Logrotate should be used to prevent unbounded disk consumption.

Loki and Promtail may be added later for centralised log viewing in Grafana.

---

# 37. Monitoring Service Deployment

The monitoring deployment bundle will follow the same controlled model:

```text
monitor_service/
├── docker-compose.monitor_service.yml
├── images/
├── monitor_service-version.json
├── ms_deploy.sh
├── ms_rollback.sh
└── MS_GUIDE.md
```

The monitoring stack may initially include:

```text
Prometheus
Grafana
Alertmanager
Node Exporter
cAdvisor
PostgreSQL exporters
Blackbox Exporter
Nginx exporter
```

The monitoring stack should be deployable and rollback-capable independently of the application stacks.

The monitoring system should remain functional during an application deployment or application rollback.

---

# 38. Health Checks

Each application service should expose a health endpoint.

Examples:

```text
/api/health/live
/api/health/ready
```

`live` should answer whether the process is running.

`ready` should answer whether the application can serve traffic, including required dependency checks.

Docker Compose health check example:

```yaml
healthcheck:
  test:
    [
      "CMD",
      "curl",
      "--fail",
      "http://localhost:8000/api/health/ready"
    ]
  interval: 15s
  timeout: 5s
  retries: 5
  start_period: 30s
```

Frontend health checks should verify that the frontend server returns a valid response.

PostgreSQL may use:

```yaml
healthcheck:
  test:
    [
      "CMD-SHELL",
      "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"
    ]
  interval: 10s
  timeout: 5s
  retries: 5
```

Deployment scripts must wait for health checks rather than assuming that `docker compose up -d` means deployment succeeded.

---

# 39. Application Security Improvements

Recommended backend protections:

* Validate all request input
* Use parameterized SQL queries
* Apply request-size limits
* Apply authentication rate limits
* Hash passwords with a modern password-hashing algorithm
* Rotate session identifiers after login
* Revoke sessions after password changes
* Enforce role-based authorization server-side
* Record sensitive administrator operations
* Use idempotency keys for financial operations
* Require re-authentication for highly sensitive actions
* Prevent mass assignment
* Limit file types and file sizes
* Scan uploaded files where applicable
* Avoid exposing detailed internal errors
* Maintain structured audit events
* Encrypt sensitive values where required
* Keep production debug mode disabled

Administrator audit events should include:

* Administrator identity
* Timestamp
* Action
* Target user or fund
* Previous value
* New value
* Request source
* Result

---

# 40. Separation of Financial Operations

Operations such as the following should receive additional safeguards:

* Investment creation
* Redemption request
* Fund-pool allocation
* AUM modification
* User approval
* Bank-detail changes
* Administrator-role changes

Recommended safeguards:

* Database transactions
* Idempotency keys
* Audit logs
* Explicit state machines
* Server-side amount validation
* Authorization checks
* Confirmation screens
* Re-authentication for sensitive administrator actions
* Immutable financial event records where appropriate

A frontend value must never be trusted as the authoritative financial value.

---

# 41. Deployment Retention

Example image rollback retention:

## Production

* Keep the last five successful releases
* Always keep the active release
* Always keep the immediately previous release
* Keep important milestone releases manually
* Delete only after checksum and version review

## Development

* Keep the last three successful releases
* Retain failed deployment logs
* Remove old image archives more aggressively

The deployment script must check storage space before preserving the current release and loading a new one.

A deployment should stop rather than remove the only usable rollback version.

---

# 42. Recommended Implementation Order

## Phase 1: Network and domain foundation

1. Confirm VPS reserved LAN IP.
2. Confirm static public WAN IP.
3. Forward router ports `80`, `443`, and `52222`.
4. Configure DNS records.
5. Configure UFW.
6. Verify SSH key-only access.
7. Install and secure Nginx.
8. Obtain HTTPS certificates.

## Phase 2: Production and development routing

1. Choose available localhost ports.
2. Record the port registry.
3. Configure production Compose bindings.
4. Configure development Compose bindings.
5. Configure production Nginx domains.
6. Configure development Nginx domains.
7. Verify same-origin `/api` routing.
8. Verify WebSockets through `wss://`.
9. Add development access protection.

## Phase 3: Deployment scripts

1. Add deployment lock.
2. Add checksum validation.
3. Add backup-drive mount check.
4. Add disk-space validation.
5. Add versioned rollback folders.
6. Add `docker save` rollback preservation.
7. Add database pre-deployment backup.
8. Add image loading.
9. Add Compose validation.
10. Add health-check waiting.
11. Add smoke tests.
12. Add atomic version-file update.
13. Add structured deployment logs.

## Phase 4: APK variants

1. Add Gradle development and production flavors.
2. Use separate package identifiers.
3. Use separate visible application names.
4. Configure dedicated API endpoints.
5. Configure dedicated WebSocket endpoints.
6. Enforce HTTPS.
7. Implement secure token storage.
8. Separate development and production signing.
9. Generate checksums.
10. Store APKs in their designated release directories.

## Phase 5: Monitoring

1. Deploy Prometheus.
2. Deploy Grafana.
3. Deploy Node Exporter.
4. Deploy cAdvisor.
5. Deploy PostgreSQL exporters.
6. Deploy Blackbox Exporter.
7. Add Nginx metrics.
8. Add application metrics.
9. Add dashboards.
10. Add Alertmanager.
11. Secure `monitor.beonedge.in`.

## Phase 6: Backup automation

1. Create host-managed backup scripts.
2. Add production scheduled backups.
3. Add development conditional backups.
4. Add pre-deployment database snapshots.
5. Add mount checks.
6. Add checksum generation.
7. Add retention.
8. Add restore testing.
9. Add monitoring metrics and alerts.
10. Plan encrypted off-server backup.

## Phase 7: Dedicated operations application

1. Define read-only monitoring API.
2. Display current release versions.
3. Display health state.
4. Display backup state.
5. Display disk and certificate state.
6. Display alerts.
7. Display deployment and rollback history.
8. Keep Grafana for advanced diagnostics.

---

# 43. Final Domain and Routing Map

```text
https://beonedge.in/
    → Production landing frontend

https://app.beonedge.in/
    → Production user frontend

https://app.beonedge.in/api/
    → Production backend

wss://app.beonedge.in/ws/
    → Production backend WebSocket

https://admin.beonedge.in/
    → Production admin frontend

https://admin.beonedge.in/api/
    → Same production backend

wss://admin.beonedge.in/ws/
    → Same production backend WebSocket

https://dev-app.beonedge.in/
    → Development user frontend

https://dev-app.beonedge.in/api/
    → Development backend

wss://dev-app.beonedge.in/ws/
    → Development backend WebSocket

https://dev-admin.beonedge.in/
    → Development admin frontend

https://dev-admin.beonedge.in/api/
    → Same development backend

https://monitor.beonedge.in/
    → Grafana or custom monitoring frontend
```

APK endpoints:

```text
Production APK API:
https://app.beonedge.in/api

Production APK WebSocket:
wss://app.beonedge.in/ws

Development APK API:
https://dev-app.beonedge.in/api

Development APK WebSocket:
wss://dev-app.beonedge.in/ws
```

---

# 44. Final Architecture Summary

The final BeOnEdge infrastructure will use the following model:

```text
Personal development computer
    │
    ├── Source code
    ├── Git
    ├── Tests
    ├── Docker builds
    ├── APK builds
    ├── docker save
    ├── gzip compression
    ├── checksums
    └── path_list.json
            │
            ▼
          rsync
            │
            ▼
BeOnEdge VPS
    │
    ├── dev_release
    ├── prod_release
    ├── monitor_service
    ├── Docker Compose
    ├── PostgreSQL
    ├── Nginx
    ├── HTTPS
    ├── deployment scripts
    ├── rollback scripts
    ├── monitoring
    └── backup management
            │
            ▼
Dedicated backup storage
    │
    ├── production rollback images
    ├── development rollback images
    ├── APK rollback artifacts
    ├── database snapshots
    ├── scheduled database backups
    ├── deployment logs
    └── restore-test records
```

This architecture is intentionally:

* Air-gapped for release delivery
* Operator controlled
* Docker Compose based
* Same-origin for browser communication
* HTTPS-only for public traffic
* Key-only for SSH
* Isolated between development and production
* Version-controlled
* Rollback capable
* Monitored
* Backup aware
* Appropriate for a single controlled company VPS
* Expandable later without requiring Kubernetes immediately


NOTE: The paths will be supplied by the paths.json file. native release_manager's scripts will not deploy the in local computer, every docker deployement will be refered as the dev-release and local testing shall be the dev_release testing suit. firstly prepare the scripts before starting any code or implementations tasks. don't change anything on the vps like starting services for ip binding and port listening for the requests made my the apk and how to make the backend expose the public internet and all, these will me addressed in presence of me. native deploy scripts should only ship the tar balls in the designated folder and all the deployement to docker shall be handled by the vps's native scripts. also look carefully for the version tracking of the local and vps stack including both dev_release and prod_release and as well as monitor_service. export should only bump up the version as its already does.

STRICT GUIDE: Do the scripts first. But before changing any scripts read them completely and understand what they do and then adapt dynamically according to the intended flow of this application deployment. The local deployements scripts deploy.sh (will ship and run the vps native scripts on the vps; i will run using args --dev and --prod; the vps's *_deploy.sh scripts will be responsible for the docker deployments commands), rollback.sh (this will be same as deploy.sh), export.sh (only responsible for exporting the images with args --dev and --prod from the source code and will be responsible for exporting the dev and release apk's as well using the ; and only lives in this computer) and status.sh (this will be the control center this will manage all the other scripts with an interractive menu. like for deployement of the backend and frontend it can this script should as dev build or release build as per (--dev and --prod) and the script should esecute the vps native scripts for the docker deployment pip lines).
