# BeOnEdge Secure Home-VPS Networking, Cloudflare, Tailscale and Broker Integration Plan

## 1. Objective

The BeOnEdge production infrastructure will run from the company home VPS while maintaining:

* A static public WAN IP required for broker IP whitelisting
* Secure outbound broker API communication
* Secure inbound broker postback/webhook communication
* Public access to the BeOnEdge customer application
* Same-origin frontend/API architecture
* HTTPS for all public application communication
* Protected development infrastructure
* Protected administration infrastructure
* Protected monitoring infrastructure
* No direct PostgreSQL exposure
* No direct Docker service exposure
* Minimal or zero router port forwarding
* Cloudflare protection for internet-facing application traffic
* Private administrative access
* Prometheus/Grafana-based monitoring
* Independent development and production APK variants

The infrastructure should remain simple enough to operate using Docker Compose, Nginx, systemd, Bash deployment scripts, Cloudflare and private networking without introducing Kubernetes.

---

# 2. Core Security Philosophy

The network should distinguish between three fundamentally different traffic types:

```text
1. PUBLIC APPLICATION TRAFFIC
   Internet users → BeOnEdge application

2. PRIVATE ADMINISTRATIVE TRAFFIC
   BeOnEdge administrators/developers → VPS

3. BROKER TRAFFIC
   Algo Engine ↔ Broker
```

These should not share the same exposure model.

The architecture will therefore follow:

```text
Public application traffic
        ↓
Cloudflare
        ↓
Cloudflare Tunnel
        ↓
Nginx
        ↓
Docker services


Administrative traffic
        ↓
Private access layer
        ↓
VPS


Broker outbound traffic
        ↓
Normal VPS network route
        ↓
Home router
        ↓
Static public IP
        ↓
Broker


Broker postbacks
        ↓
Dedicated HTTPS hostname
        ↓
Cloudflare
        ↓
Cloudflare Tunnel
        ↓
Nginx
        ↓
Algo Engine
```

This keeps the static public IP primarily as an **outbound network identity** rather than using it as the public entrance to the VPS.

---

# 3. Static Public IP Purpose

The static WAN IP exists primarily because the broker requires the Algo Engine's outgoing order-placement traffic to originate from a whitelisted public IP.

Example:

```text
Algo Engine container
        ↓
Docker bridge network
        ↓
VPS network interface
        ↓
Home router
        ↓
NAT
        ↓
STATIC_PUBLIC_IP
        ↓
Broker API
```

The broker therefore sees:

```text
Source IP = STATIC_PUBLIC_IP
```

The private VPS address such as:

```text
192.168.x.x
```

is never visible to the broker.

The broker account should whitelist:

```text
STATIC_PUBLIC_IP
```

---

# 4. Static IP and Cloudflare Are Independent

Cloudflare Tunnel does not normally replace the VPS default route.

Therefore:

```text
Application inbound traffic
        ↓
Cloudflare Tunnel
```

and:

```text
Broker outbound traffic
        ↓
Normal Internet gateway
        ↓
Static WAN IP
```

can operate simultaneously.

The Algo Engine must NOT route broker traffic through:

* Cloudflare WARP
* Tailscale Exit Node
* Commercial VPN
* Tor
* SOCKS proxy
* HTTP proxy
* Alternate gateway

unless explicitly intended.

The VPS default route must remain:

```text
VPS
 ↓
Home router
 ↓
Static public WAN IP
 ↓
Internet
```

---

# 5. Verify Broker Egress IP

The public egress address should be verified from the host:

```bash
curl https://api.ipify.org
echo
```

The same check should also be performed from inside the Algo Engine container:

```bash
docker exec <ALGO_CONTAINER_ID> \
    curl https://api.ipify.org
```

Both should return the broker-whitelisted static public IP.

The monitoring service should eventually automate this verification.

Conceptual metric:

```text
expected_broker_egress_ip = STATIC_PUBLIC_IP

actual_broker_egress_ip = CURRENT_PUBLIC_IP
```

If:

```text
expected != actual
```

generate a critical alert before market operation.

Possible causes include:

* ISP routing changes
* Router configuration errors
* VPN activation
* Tailscale Exit Node activation
* Network failover
* Gateway changes

---

# 6. Public Domain Architecture

Primary domain:

```text
beonedge.in
```

Recommended hostname structure:

```text
beonedge.in
www.beonedge.in

app.beonedge.in
admin.beonedge.in

dev-app.beonedge.in
dev-admin.beonedge.in

broker-api.beonedge.in

monitor.beonedge.in
```

Optional future hostnames:

```text
status.beonedge.in
docs.beonedge.in
```

Do NOT create a public DNS record such as:

```text
ssh.beonedge.in → STATIC_PUBLIC_IP
```

because doing so unnecessarily reveals the home origin IP.

---

# 7. Cloudflare DNS

The `beonedge.in` DNS zone will be managed through Cloudflare.

Public application hostnames should be proxied through Cloudflare.

Example:

```text
beonedge.in
        ↓
Cloudflare

app.beonedge.in
        ↓
Cloudflare

admin.beonedge.in
        ↓
Cloudflare

dev-app.beonedge.in
        ↓
Cloudflare

broker-api.beonedge.in
        ↓
Cloudflare

monitor.beonedge.in
        ↓
Cloudflare
```

The static home WAN IP should not unnecessarily appear in public DNS records.

The public application should always reference domains rather than raw IP addresses.

Correct:

```text
https://app.beonedge.in
```

Incorrect:

```text
https://STATIC_PUBLIC_IP:8000
```

---

# 8. Cloudflare Tunnel

Install `cloudflared` on the VPS.

The tunnel should be initiated outbound from the VPS toward Cloudflare.

Conceptual topology:

```text
VPS
 │
 └── cloudflared
         │
         └──── outbound encrypted tunnel
                     ↓
                 Cloudflare
```

Incoming application users connect to Cloudflare rather than directly connecting to the home router.

Example:

```text
Internet User
     ↓
Cloudflare
     ↓
Cloudflare Tunnel
     ↓
Nginx
     ↓
Application
```

This allows the application to work even when the router does not expose inbound HTTPS ports directly.

---

# 9. Recommended Router Exposure

Long-term target configuration:

```text
NO PUBLIC APPLICATION PORT FORWARDING
NO DATABASE PORT FORWARDING
NO GRAFANA PORT FORWARDING
NO PROMETHEUS PORT FORWARDING
NO DOCKER PORT FORWARDING
```

Potentially:

```text
80      CLOSED
443     CLOSED
3000    CLOSED
5432    CLOSED
6379    CLOSED
8000    CLOSED
8080    CLOSED
9090    CLOSED
```

because Cloudflare Tunnel provides the public application ingress.

The existing rule:

```text
WAN 52222 → VPS 22
```

can also eventually be removed once private SSH access is fully tested.

The router will still retain its static public IP.

No inbound port-forwarding rule is required merely to retain a static outbound address.

---

# 10. Cloudflare Security Responsibilities

Cloudflare will provide the first public security layer.

Responsibilities:

```text
DNS
HTTPS
TLS
DDoS mitigation
Reverse proxy
Cloudflare Tunnel
Basic WAF protection
Rate/security rules
Origin hiding
Cloudflare Access where appropriate
```

Traffic becomes:

```text
Client
 ↓
Cloudflare network
 ↓
DDoS filtering
 ↓
WAF/security rules
 ↓
Tunnel
 ↓
Nginx
 ↓
Backend
```

This means obvious hostile traffic can be filtered before reaching the home connection through the application route.

---

# 11. Important DDoS Limitation

Cloudflare protects traffic that actually passes through Cloudflare.

If an attacker knows the static WAN IP and sends traffic directly to:

```text
STATIC_PUBLIC_IP
```

Cloudflare is not in that path.

Example:

```text
Attacker
 ↓
STATIC_PUBLIC_IP
 ↓
ISP
 ↓
Home connection
```

A sufficiently large volumetric attack may saturate the home Internet connection even if the router or VPS rejects every packet.

Therefore, the static origin IP should be treated as sensitive infrastructure information.

Avoid exposing it through:

* Public DNS
* Frontend JavaScript
* APK configuration
* Public Git repositories
* Documentation
* Screenshots
* WebSocket URLs
* Public API configuration
* Monitoring dashboards

The broker is one of the few external systems that genuinely needs the static public address.

---

# 12. Same-Origin Production Application

Production customer application:

```text
https://app.beonedge.in
```

Frontend requests should use relative API paths:

```text
/api
```

Examples:

```text
GET  /api/auth/status
GET  /api/portfolio
POST /api/investment
POST /api/redemption
```

WebSocket:

```text
/ws
```

Nginx routing:

```text
https://app.beonedge.in/
        ↓
Production frontend

https://app.beonedge.in/api/
        ↓
Production backend

wss://app.beonedge.in/ws/
        ↓
Production backend
```

The browser therefore sees:

```text
Scheme = https
Host   = app.beonedge.in
Port   = 443
```

for both frontend and API.

This produces the desired same-origin architecture.

---

# 13. Production Administrator Application

Production administrator application:

```text
https://admin.beonedge.in
```

Routing:

```text
/
    ↓
Production admin frontend

/api/
    ↓
Same production backend

/ws/
    ↓
Same production backend
```

The backend remains responsible for authorization.

The server must never assume:

```text
request came from admin.beonedge.in
        =
request is from an administrator
```

Every administrative operation must validate:

* Authentication
* User account status
* Administrative role
* Required permission
* Resource ownership where applicable
* Session/token validity
* CSRF protections when cookie sessions are used

---

# 14. Development Stack

Development user application:

```text
https://dev-app.beonedge.in
```

Development administrator application:

```text
https://dev-admin.beonedge.in
```

They connect only to:

```text
Development backend
Development PostgreSQL
Development Docker network
Development secrets
```

Production and development must not share:

```text
Database
Database volume
Backend container
Docker internal network
JWT keys
Session secrets
Cookie names
Encryption keys
API credentials
Broker test credentials
```

---

# 15. Tailscale Role

Tailscale will be used for private device-to-VPS networking while the current free setup remains suitable.

Primary intended uses:

```text
SSH administration

Grafana access

Internal developer tools

Private troubleshooting

Server maintenance
```

Conceptually:

```text
Authorized laptop
      ↓
Tailscale network
      ↓
BeOnEdge VPS
```

Instead of:

```text
Internet
   ↓
STATIC_PUBLIC_IP:52222
   ↓
SSH
```

---

# 16. Tailscale Free-Tier Caveat

The current Tailscale Personal plan is free but is officially intended for personal/non-commercial use.

Therefore, it should not be assumed that free Personal Tailscale is a permanent commercial-company infrastructure entitlement.

For the initial environment:

```text
Tailscale may be used where account terms permit.
```

If commercial usage requires migration later, possible replacements are:

```text
Cloudflare Access
Cloudflare SSH through Tunnel
Self-hosted WireGuard
Paid Tailscale business tier
```

The rest of the architecture does not depend on Tailscale specifically.

Tailscale is an access transport layer, not an application dependency.

---

# 17. SSH Architecture

Current state:

```text
Internet
 ↓
Public 52222
 ↓
Router
 ↓
VPS 22
 ↓
OpenSSH
```

Authentication:

```text
SSH private key only
Password login disabled
Root login disabled
```

Target state:

```text
Authorized computer
 ↓
Private network
 ↓
VPS Tailscale/WireGuard address
 ↓
OpenSSH :22
```

Then remove:

```text
WAN 52222 → 22
```

OpenSSH can continue using normal SSH private keys even when transported through Tailscale.

This gives:

```text
Private network membership
        +
SSH private key
        =
two independent access boundaries
```

---

# 18. Admin Panel Through Private Access

The production admin panel should receive stronger access controls than the public customer application.

Preferred design:

```text
Admin laptop
     ↓
Private access layer
     ↓
admin.beonedge.in
     ↓
Nginx
     ↓
Admin frontend
```

Possible configurations:

### Option A

Admin panel reachable only through private networking.

### Option B

Admin hostname protected by Cloudflare Access.

### Option C

Both private network restriction and application authentication.

Regardless of network protection, application-level administrator authentication remains mandatory.

---

# 19. Monitoring Access

Monitoring components:

```text
Grafana
Prometheus
Alertmanager
Node Exporter
cAdvisor
PostgreSQL Exporter
Blackbox Exporter
Nginx metrics
Application metrics
```

Only Grafana or a custom monitoring frontend should ever have a user-facing interface.

Prometheus should not be publicly exposed.

PostgreSQL exporters should not be publicly exposed.

cAdvisor should not be publicly exposed.

Recommended:

```text
Admin laptop
     ↓
Tailscale/private network
     ↓
Grafana
```

or:

```text
Admin
 ↓
Cloudflare Access
 ↓
monitor.beonedge.in
 ↓
Grafana
```

---

# 20. PostgreSQL Networking

Production PostgreSQL:

```text
NO HOST PORT BINDING
```

Development PostgreSQL:

```text
NO HOST PORT BINDING
```

Connection:

```text
Backend
 ↓
Internal Docker network
 ↓
PostgreSQL service name:5432
```

Example:

```text
prod_backend
    ↓
prod_postgres:5432
```

The host should not expose:

```text
0.0.0.0:5432
```

or:

```text
127.0.0.1:5432
```

unless there is an explicit operational reason.

Database management and backups can use:

```bash
docker compose exec
```

from the VPS.

---

# 21. Local Docker Port Bindings

Frontend and backend Docker services that Nginx must reach should bind only to localhost.

Example:

```yaml
ports:
  - "127.0.0.1:<HOST_PORT>:<CONTAINER_PORT>"
```

Never:

```yaml
ports:
  - "<HOST_PORT>:<CONTAINER_PORT>"
```

unless deliberate public exposure is required.

The chosen ports will be manually selected after checking availability.

Use:

```bash
sudo ss -lntup
```

or:

```bash
sudo lsof -i :<PORT>
```

The port registry should be documented centrally.

---

# 22. Broker API Outbound Communication

The Algo Engine will communicate directly with the broker using normal outbound HTTPS/WebSocket connectivity.

Flow:

```text
Algo Engine
 ↓
Docker network
 ↓
VPS
 ↓
Home router
 ↓
STATIC_PUBLIC_IP
 ↓
Broker
```

The broker account will whitelist:

```text
STATIC_PUBLIC_IP
```

No Cloudflare Tunnel is involved in this direction.

---

# 23. Broker Postback Architecture

The broker also needs to send execution results back to BeOnEdge.

Dedicated callback hostname:

```text
broker-api.beonedge.in
```

Recommended callback:

```text
https://broker-api.beonedge.in/<BROKER>/postback
```

Example:

```text
https://broker-api.beonedge.in/kite/postback
```

Traffic:

```text
Broker
 ↓
broker-api.beonedge.in
 ↓
Cloudflare
 ↓
Cloudflare Tunnel
 ↓
Nginx
 ↓
Algo/backend postback receiver
```

The broker therefore does not need direct access to:

```text
STATIC_PUBLIC_IP:<PORT>
```

---

# 24. Broker Postback Nginx Isolation

The broker hostname should expose only required broker callback routes.

Conceptual Nginx:

```nginx
server {
    server_name broker-api.beonedge.in;

    location = /kite/postback {
        proxy_pass http://127.0.0.1:<ALGO_BACKEND_PORT>;

        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        client_max_body_size 1m;
    }

    location / {
        return 404;
    }
}
```

Exact-match routing:

```nginx
location = /kite/postback
```

prevents unrelated URLs on the hostname from being accepted.

---

# 25. Broker Postback Authentication

Postbacks must never be trusted merely because they reached the correct URL.

The callback must validate the broker-provided cryptographic verification mechanism.

For Kite-style postbacks:

```text
order_id
+
order_timestamp
+
API_SECRET
        ↓
SHA-256
        ↓
Expected checksum
```

Compare against the checksum received from the broker.

Use constant-time comparison where practical.

Processing:

```text
Receive POST
 ↓
Validate HTTP structure
 ↓
Validate required fields
 ↓
Verify checksum
 ↓
Reject invalid callback
 ↓
Persist valid event
```

The API secret must remain server-side only.

---

# 26. Broker Postback Idempotency

The webhook handler must assume events may be delivered more than once.

Incorrect:

```text
callback
 ↓
execute business operation
 ↓
duplicate callback
 ↓
execute same business operation again
```

Correct:

```text
callback
 ↓
Verify authenticity
 ↓
Identify event
 ↓
Already processed?
 ├── YES → safely acknowledge
 └── NO  → record/process
```

Do not deduplicate using only:

```text
order_id
```

because one order can generate multiple legitimate status changes.

The event model should consider:

```text
order_id
status
update timestamp
filled quantity
broker event data
```

---

# 27. Broker Order State Architecture

Do not treat only one broker communication channel as authoritative.

Recommended design:

```text
Place order
 ↓
Broker returns order_id
 ↓
Local state = SUBMITTED
 ↓
        ┌──────────────────┐
        │                  │
        ▼                  ▼
Broker WebSocket       Broker Postback
        │                  │
        └────────┬─────────┘
                 ▼
         Order State Engine
                 │
                 ▼
        Periodic Broker API
          reconciliation
                 │
                 ▼
        Final local state
```

This protects against:

* Lost postbacks
* WebSocket disconnects
* Duplicate callbacks
* Temporary backend failure
* Delayed order updates
* Local process restart

---

# 28. Postback Receiver Design

The postback endpoint should remain lightweight.

Recommended:

```text
Receive request
 ↓
Validate checksum
 ↓
Validate schema
 ↓
Persist event
 ↓
Publish/internal queue
 ↓
Return HTTP success
```

Avoid:

```text
Receive postback
 ↓
Run entire trading strategy
 ↓
Run expensive calculations
 ↓
Perform unrelated work
 ↓
Eventually respond
```

Trading and risk processing should occur asynchronously through the application's internal state/event architecture.

---

# 29. Cloudflare Access

Cloudflare Access can be used for restricted application surfaces.

Good candidates:

```text
admin.beonedge.in

dev-app.beonedge.in

dev-admin.beonedge.in

monitor.beonedge.in
```

Access can sit before the application:

```text
User
 ↓
Cloudflare Access
 ↓
Identity verification
 ↓
Cloudflare Tunnel
 ↓
Nginx
 ↓
Application
```

Do NOT put interactive Cloudflare Access authentication in front of:

```text
broker-api.beonedge.in/kite/postback
```

because the broker cannot complete an interactive Access login.

The broker callback uses:

```text
HTTPS
+
Cloudflare network protections
+
strict route
+
broker checksum authentication
```

instead.

---

# 30. Development Environment Protection

Development is only for selected testers.

Protect it using multiple layers:

```text
Cloudflare
 ↓
Cloudflare Access or private networking
 ↓
Nginx
 ↓
Application authentication
```

Additionally:

```text
X-Robots-Tag: noindex, nofollow
```

and:

```text
robots.txt
```

should prevent accidental indexing.

Development must never contain real production customer data unless specifically sanitized and approved.

---

# 31. Production APK

Production Android package:

```text
in.beonedge.app
```

Display name:

```text
BeOnEdge
```

Production API:

```text
https://app.beonedge.in/api
```

Production WebSocket:

```text
wss://app.beonedge.in/ws
```

The production APK must never contain the raw static WAN IP.

The application should know only DNS hostnames.

---

# 32. Development APK

Development Android package:

```text
in.beonedge.app.dev
```

Display name:

```text
BeOnEdge Dev
```

Development API:

```text
https://dev-app.beonedge.in/api
```

Development WebSocket:

```text
wss://dev-app.beonedge.in/ws
```

The development APK should use:

* Different package ID
* Different name
* Visually different icon
* Different backend
* Different database
* Different authentication secrets

Both APKs can therefore coexist on one Android device.

---

# 33. Capacitor Networking

The APK frontend is produced using:

```text
Frontend
 ↓
Capacitor
 ↓
Gradle
 ↓
Android APK
```

The production APK should bundle the frontend locally.

Do not use production live reload.

Do not configure production APK with a local development server.

Network traffic must use:

```text
HTTPS
WSS
```

Cleartext HTTP should be disabled.

---

# 34. Browser vs APK Networking

Browser:

```text
https://app.beonedge.in
```

can use relative:

```text
/api
```

for true same-origin communication.

Capacitor APK may internally originate from:

```text
capacitor://localhost
```

or an equivalent local WebView origin.

Therefore the APK may use:

```text
https://app.beonedge.in/api
```

as an absolute API destination.

Possible approaches:

```text
Native Capacitor HTTP transport
```

or carefully configured CORS for exact known application origins.

Never broadly use:

```text
Access-Control-Allow-Origin: *
```

with sensitive authenticated APIs.

---

# 35. Mobile Authentication

Recommended mobile authentication:

```text
short-lived access token
+
rotating refresh token
```

API request:

```text
Authorization: Bearer <TOKEN>
```

Long-lived credentials should use secure storage backed by Android Keystore.

Do not store sensitive tokens in:

```text
plain localStorage
source files
APK configuration files
plain preferences
Git
```

---

# 36. APK Signing

Production signing keys remain on the trusted development/release computer.

They must never be transferred to the VPS.

VPS receives:

```text
signed APK
checksum
version metadata
```

Production and development signing configuration should remain logically separated.

---

# 37. Nginx Security Layer

Nginx remains the local reverse proxy and second application security layer.

Responsibilities:

```text
Route frontend requests
Route API requests
Route WebSockets
Request-size limits
Rate limiting
Security headers
Proxy headers
Access logs
Exact broker callback routing
```

Example API rate limiting:

```nginx
limit_req_zone $binary_remote_addr
               zone=general_api:20m
               rate=<RATE>;
```

Authentication endpoints should have significantly stricter limits.

---

# 38. Cloudflare Real Client IP

Because Cloudflare sits in front of Nginx, the VPS must correctly determine the actual client address.

Nginx should trust only official Cloudflare proxy networks when processing Cloudflare client-IP headers.

Do not blindly trust incoming:

```text
X-Forwarded-For
```

from arbitrary clients.

Cloudflare's published IP ranges should be used.

This matters for:

* Rate limiting
* Logs
* Abuse detection
* Security auditing

---

# 39. UFW / Host Firewall

Base policy:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
```

If application ingress occurs exclusively through Cloudflare Tunnel and SSH through private networking, very few inbound host services need public access.

PostgreSQL should never be allowed publicly.

Prometheus should never be allowed publicly.

Docker application ports should never be allowed publicly.

---

# 40. Docker Security

Application containers should use, where compatible:

```yaml
security_opt:
  - no-new-privileges:true
```

and:

```yaml
cap_drop:
  - ALL
```

Prefer non-root container users.

Where possible:

```yaml
read_only: true
```

Use:

```yaml
tmpfs:
  - /tmp
```

where appropriate.

Apply CPU/memory limits to development workloads so development cannot destabilize production.

---

# 41. Docker Socket Security

Do not mount:

```text
/var/run/docker.sock
```

into normal application containers.

Avoid giving the monitoring stack unrestricted Docker socket access.

Host-level backup/deployment scripts should execute required Docker commands instead.

This prevents compromise of one monitoring/application container from automatically becoming host-level control.

---

# 42. Monitoring Stack

Initial monitoring stack:

```text
Prometheus
Grafana
Alertmanager
Node Exporter
cAdvisor
PostgreSQL Exporter
Blackbox Exporter
Nginx metrics
Application metrics
```

Potential future addition:

```text
Loki
Promtail
```

for centralized logs.

---

# 43. Broker Monitoring Metrics

Recommended broker-specific metrics:

```text
broker_api_reachable

broker_egress_ip_valid

broker_websocket_connected

broker_postbacks_total

broker_postbacks_valid_total

broker_postbacks_invalid_total

broker_postback_last_received_timestamp

broker_order_reconciliation_mismatch_total

broker_order_execution_errors_total
```

Grafana dashboard example:

```text
BROKER STATUS

Whitelisted egress IP       OK
Broker API                  ONLINE
Broker WebSocket            CONNECTED
Last postback               10:23:14
Postbacks today             127
Invalid postbacks           0
Reconciliation mismatches   0
```

---

# 44. Infrastructure Monitoring

Monitor:

```text
CPU
RAM
load average
swap
filesystem usage
inode usage
disk I/O
network I/O
Docker container status
container restarts
Nginx availability
PostgreSQL availability
HTTP response codes
API latency
WebSocket state
certificate expiration
backup success
```

---

# 45. Database Backup Responsibilities

The monitoring/operations subsystem manages backups for:

```text
Development PostgreSQL
Production PostgreSQL
```

PostgreSQL remains inaccessible from outside Docker.

Backup command pattern:

```bash
docker compose \
  -f <COMPOSE_FILE> \
  exec -T <POSTGRES_SERVICE> \
  pg_dump ...
```

Backup tasks should preferably run as root-owned host scripts controlled through systemd timers rather than giving a monitoring container control of Docker.

---

# 46. Backup Storage

Primary backup path:

```text
/srv/backup/BOE_APP/
```

Before every backup:

```bash
mountpoint -q /srv/backup
```

If this fails:

```text
STOP BACKUP
GENERATE ALERT
```

This prevents accidental backup writes to the root filesystem when the backup drive is not mounted.

---

# 47. Deployment Architecture

Release source:

```text
Personal development machine
```

Responsibilities:

```text
Source code
Git
Testing
Docker builds
APK builds
docker save
gzip compression
checksums
release metadata
path_list.json
```

Transfer:

```text
rsync
```

Destination:

```text
/srv/dev_stack/BOE_APP/
```

No application source code is required on the VPS.

---

# 48. Air-Gapped Release Model

Deployment flow:

```text
Source code
 ↓
Tests
 ↓
Build
 ↓
Docker image
 ↓
docker save
 ↓
gzip
 ↓
checksum
 ↓
rsync
 ↓
dev_release / prod_release
 ↓
native VPS deploy script
```

No automatic Git pull.

No automatic Docker registry pull.

No Kubernetes.

No automatic production deployment.

The operator explicitly transfers and activates each release.

---

# 49. Version and Rollback Model

Version files:

```text
dev-version.json
release-version.json
monitor_service-version.json
```

Before replacing an active deployment:

```text
Read active version
 ↓
Create rollback directory
 ↓
docker save current images
 ↓
Store versioned artifacts
 ↓
Deploy new images
 ↓
Health check
 ↓
Update version JSON
```

Example rollback:

```text
PROD_ROLLBACK/
    IMAGES/
        v1.4.2/
            backend.tar.gz
            frontend.tar.gz
            admin-frontend.tar.gz
```

---

# 50. Monitoring Access Strategy

Preferred monitoring path:

```text
Authorized operator
 ↓
Private access
 ↓
Grafana
```

Do not expose:

```text
Prometheus
cAdvisor
Node Exporter
PostgreSQL Exporter
Alertmanager API
```

to the general Internet.

---

# 51. Cloudflare Free-Tier Usage

Initial Cloudflare architecture should use available free services:

```text
Cloudflare DNS

Cloudflare proxy/CDN

Cloudflare Tunnel

Cloudflare HTTPS/TLS

Cloudflare DDoS protection

Cloudflare Free WAF capabilities

Cloudflare Zero Trust / Access
within current free limits
```

The architecture must not depend on paid Cloudflare-only functionality.

If future usage or security requirements exceed free capabilities, upgrades can be evaluated separately.

---

# 52. Tailscale Free-Tier Usage

Initial Tailscale use remains small:

```text
Developer laptops
VPS
Possibly selected infrastructure devices
```

Primary purpose:

```text
Private administration
```

Do not configure the VPS to use a Tailscale Exit Node because that could alter the broker-facing public egress IP.

Normal desired routing:

```text
Tailscale
    → private/admin destinations only

Default Internet route
    → home router
    → static WAN IP
```

---

# 53. Final Network Diagram

```text
                                INTERNET
                                   │
                ┌──────────────────┼──────────────────┐
                │                  │                  │
                │                  │                  │
          APPLICATION USERS     BROKER             ADMINS
                │                  │                  │
                ▼                  │                  ▼
           CLOUDFLARE              │             PRIVATE ACCESS
                │                  │            Tailscale / Access
        DDoS / WAF / TLS           │                  │
                │                  │                  ▼
                ▼                  │                 VPS
        CLOUDFLARE TUNNEL          │                  │
                │                  │             SSH / Grafana
                ▼                  │
              NGINX                │
                │                  │
       ┌────────┼──────────────┐   │
       │        │              │   │
       ▼        ▼              ▼   │
    Landing   App/Admin    Broker Callback
   Frontend   Frontends       Receiver
                │                │
                ▼                ▼
            Backend         Algo Engine
                │                │
                ▼                │
           PostgreSQL            │
                                 │
                                 ▼
                              VPS NIC
                                 │
                                 ▼
                           HOME ROUTER
                                 │
                                 ▼
                          STATIC WAN IP
                                 │
                                 ▼
                              BROKER
```

---

# 54. Traffic Direction Summary

## Customer application

```text
Customer
 ↓
Cloudflare
 ↓
Tunnel
 ↓
Nginx
 ↓
Frontend/API
```

## Production APK

```text
APK
 ↓
https://app.beonedge.in
 ↓
Cloudflare
 ↓
Tunnel
 ↓
Nginx
 ↓
Production backend
```

## Development APK

```text
Dev APK
 ↓
https://dev-app.beonedge.in
 ↓
Cloudflare / restricted access
 ↓
Tunnel
 ↓
Development backend
```

## Broker order placement

```text
Algo Engine
 ↓
VPS
 ↓
Router
 ↓
STATIC_PUBLIC_IP
 ↓
Broker API
```

## Broker postback

```text
Broker
 ↓
https://broker-api.beonedge.in/kite/postback
 ↓
Cloudflare
 ↓
Tunnel
 ↓
Nginx
 ↓
Postback receiver
```

## SSH

```text
Developer laptop
 ↓
Private network
 ↓
VPS:22
```

## Grafana

```text
Authorized operator
 ↓
Private network / Cloudflare Access
 ↓
Grafana
```

## PostgreSQL

```text
Backend
 ↓
Internal Docker network
 ↓
PostgreSQL:5432
```

No public route exists.

---

# 55. Final Security Layers

The BeOnEdge stack follows:

```text
LAYER 1
Cloudflare edge protection

LAYER 2
Cloudflare Tunnel / private connectivity

LAYER 3
Nginx reverse proxy and rate limiting

LAYER 4
Application authentication

LAYER 5
Application authorization / RBAC

LAYER 6
Container isolation

LAYER 7
Internal Docker networking

LAYER 8
PostgreSQL least-privilege access

LAYER 9
Host firewall and SSH security

LAYER 10
Monitoring and alerting

LAYER 11
Versioned rollback

LAYER 12
Database backups and restore testing
```

The objective is not to assume attacks can always be prevented.

The architecture should provide:

```text
PREVENT
   ↓
LIMIT
   ↓
DETECT
   ↓
RECOVER
```

---

# 56. Agreed Initial Architecture

For the current stage, BeOnEdge will use:

```text
Docker Compose
Nginx
PostgreSQL
Cloudflare Free services
Cloudflare Tunnel
Cloudflare Zero Trust / Access where appropriate
Tailscale/private networking where permitted
Prometheus
Grafana
Alertmanager
Node Exporter
cAdvisor
PostgreSQL Exporter
Blackbox Exporter
systemd
Bash deployment scripts
rsync
Docker image archives
version-controlled rollback
```

Kubernetes will not be introduced at this stage.

The architecture intentionally prioritizes:

```text
Simplicity
Control
Security
Observability
Deterministic deployment
Understandability
Recoverability
```

over unnecessary orchestration complexity.

---

# 57. Long-Term Upgrade Triggers

The current architecture should remain until actual operational requirements justify changes.

Possible future triggers include:

```text
Multiple physical production servers
High availability requirements
Horizontal application scaling
Large engineering team
Frequent independent deployments
Complex service discovery
Multiple production regions
Large-scale internal networking
Stricter compliance requirements
```

Only then should technologies such as:

```text
Kubernetes
Dedicated load balancers
Managed database clusters
Paid Zero Trust services
Paid enterprise networking
```

be evaluated.

Until then, the current architecture provides a controlled and understandable infrastructure suitable for the present BeOnEdge deployment model.
