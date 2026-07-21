# 03 · Client-App Controls (App Management + Operations)

What the admin is meant to control **inside the client investing app** — the app
shell/config, the **fund pools** clients invest in, and the investing operations
(orders, holdings, payments, mandates, SIPs, redemptions).

## App configuration

### App builder — `/admin/app/builder` → `AppBuilderScreen`
- **Calls:** `GET/PUT /v1/admin/app-config` (via `shared/appConfig.js`
  `loadRemoteAppConfig`/`publishAppConfig`). The public client reads
  `GET /v1/app-config`.
- **Canonical schema:** `app_config_versions` (016) — versioned JSON, one current
  row, 32-byte digest; payload is **only** typed presentation, feature flags,
  minimum-client-version, and download metadata. **Products, funds, money,
  ownership, permissions, thresholds, lifecycle are forbidden** in this payload.
- **Status:** 🔴 BROKEN + **reshape required.** The legacy app-builder embeds
  `mobile.products`/strategies and per-screen component layouts that mix in fund
  data — which the canonical config forbids. The build must split: *presentation/
  feature-flags* → `app_config_versions`; *fund data* → the funds/catalog domain.

### Environment — `/admin/system/environment` → `EnvironmentScreen`
- **Calls:** `GET /v1/admin/app-config`.
- **Status:** 🔴 BROKEN (read-only view over app-config; folds into the app-config slice).

## Fund pools & investing operations

> These are the **fund pools** the product vision centers on: the admin creates
> pools tiered by risk/return (`fund_versions.risk_level`), publishes NAV/AUM, and
> clients choose a pool to invest in (per decisions 8-9, risk lives on the fund,
> not the client).

### AUM pools — `/admin/ops/funds` → `AumScreen` (tabs)
- **Calls:** `GET/POST/PATCH /v1/admin/funds` + `/v1/admin/funds/:id`
  (Allocations), `/v1/admin/capital-transactions` (Capital tab),
  `/v1/admin/redemption-requests` (Redemptions tab).
- **Canonical schema:** `funds`, `fund_versions`, `fund_disclosure_versions`,
  `fund_nav_prices`, `fund_positions`, `fund_aum_snapshots` (015);
  `redemption_requests` (017). Publication/NAV/AUM corrections require
  maker-checker (`approval_actions`, 012) per spec 03 §5.2.
- **Status:** 🔴 BROKEN for funds/allocations/redemptions (buildable — schema
  exists). 🟠 **OBSOLETE** for the Capital tab: `capital_transactions` was
  **removed** (spec 03 §8 — "no fake ledger"); AUM is `fund_aum_snapshots`, not a
  capital ledger.
- **Note on "return tier":** the product wants clients to see *low/moderate/high
  return* alongside risk. `fund_versions` has `risk_level` but **no return
  field** — add a `return_tier`/expected-return label when building fund creation.

### Holdings — `/admin/ops/holdings` → `HoldingsScreen`
- **Reads** the funds collection; intended to show client ownership per fund.
- **Canonical schema:** `holdings`, `holding_lots`, `holding_lot_movements` (017).
- **Status:** 🔴 BROKEN (buildable — an admin read/rollup over authoritative holdings).

### Transactions — `/admin/ops/transactions` → `TransactionsScreen`
- **Calls:** `GET /v1/admin/transactions`.
- **Canonical schema:** `investment_orders` + append-only `investment_executions` (017).
- **Status:** 🔴 BROKEN (buildable — admin read of orders/executions).

### Ledger — `/admin/ops/ledger` → `LedgerScreen`
- **Calls:** `GET /v1/admin/reconciliation-ledger`.
- **Status:** 🟠 **OBSOLETE.** `ledger_entries` was removed (spec 03 §8). Replace
  the concept with a reconciliation view built from authoritative
  executions/payments/provider events, not a general ledger.

### SIP control — `/admin/ops/sip-control` → `SipControlScreen`
- **Calls:** `GET/POST /v1/admin/sip-control-requests` (+ `/:id`).
- **Canonical schema:** `sip_plans` (017).
- **Status:** 🔴 BROKEN + partly 🟠. Spec 03 §8: accepted controls are **SIP
  commands + audit events**; pending high-risk actions use `approval_actions`.
  There is no `sip_control_requests` queue table — rebuild as SIP admin
  commands (pause/resume/cancel) over the existing SIP lifecycle (RA-C.9).

### Payments — `/admin/users/payments` → `PaymentsScreen`
- **Calls:** `GET /v1/admin/payments` (+ approve/reject actions in the legacy context).
- **Canonical schema:** `payments`, `payment_attempts` (018). Confirmation is
  provider-driven (RA-C.8 webhook); manual approve/reject is **not** the canonical
  path.
- **Status:** 🔴 BROKEN (buildable as a **read/oversight** view; the legacy
  approve/reject actions are 🟠 — payments succeed/fail via the provider webhook, not admin buttons).

### Subscriptions/Mandates — `/admin/users/subscriptions` → `MandatesScreen`
- **Calls:** `GET /v1/admin/mandates`.
- **Canonical schema:** `mandates` (017). Activation is webhook-driven (RA-C.9).
- **Status:** 🔴 BROKEN (buildable as a read/oversight view). Nav label
  "Subscriptions" is misleading — it renders mandates.

## Build note
The fund/catalog domain (create pools → publish version + NAV + AUM, with
maker-checker) is the **highest-leverage** client-app admin slice: it is what
makes funds exist through the API rather than test seeds, and unblocks the whole
client invest→book→holdings flow end-to-end in the running app. See
[[05-backend-gaps-and-build-plan]].
