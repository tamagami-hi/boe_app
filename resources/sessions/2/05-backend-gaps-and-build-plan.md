# 05 · Backend Gaps & Proposed Admin Build Order

Categorizes every admin gap by disposition, then proposes a build order. Each
build slice follows the Session-1 discipline: contract → repository → command →
route → tests (unit + Testcontainers integration) → gates (`npm run check` +
`npm run test:integration`) → guards (diff-check, Legacy hash, zero-JS) → docs →
commit → push. Stop before APK/Capacitor/Gradle.

## A. BUILD — schema exists, routes missing (buildable now)

| Domain | Endpoints to build | Canonical schema | Notes |
|---|---|---|---|
| **Fund pools / catalog** | create fund, publish version (+disclosure+NAV), publish/correct AUM, list/detail | funds/fund_versions/fund_disclosure_versions/fund_nav_prices/fund_positions/fund_aum_snapshots (015) | Publication/NAV/AUM correction require **maker-checker** (`approval_actions`, 012). Add a **`return_tier`** to `fund_versions` for the client's risk/return display. |
| Courses | CRUD + publish | courses (016) | Clean versioned CRUD. |
| Membership plans | CRUD + publish | membership_plans (016) | Clean versioned CRUD. |
| FAQs / site content | CRUD + publish | content_items (016) | Target `content_items` (kind=faq/static_page/legal_disclosure); no `faqs` table. |
| App config | get/publish current | app_config_versions (016) | Presentation/feature-flags/min-version/download **only**; strip fund/product data from the legacy builder. |
| Audit log viewer | list (keyset, redacted) | audit_events (012) | Read-only; evidence already written. |
| User directory + lifecycle | list/detail + suspend/reinstate/close | users (010) + sessions | Add `suspendUser`/`reinstateUser`/`closeUser` commands (spec §5.2). |
| Admin oversight reads | orders/executions, holdings, payments, mandates, redemptions (read/rollup) | 017/018 | Owner-scoped admin reads over authoritative financial evidence. |

## B. NEEDS MODELING first

| Item | Decision needed |
|---|---|
| Landing "page content" (hero/benefits/…) | No canonical table. Choose: versioned `content_items` per section **vs** a dedicated `site_content` table. `app_config_versions` is the wrong home (forbids non-presentation; marketing copy is a stretch). |
| Fund "return tier" | Add `return_tier` (or expected-return band) to `fund_versions` so clients see low/moderate/high **return** next to `risk_level`. |

## C. OBSOLETE — remove or repurpose (do NOT build as-is)

| Screen/endpoint | Why | Action |
|---|---|---|
| Risk profiles (`/v1/admin/risk-profiles`) | Decision 9: no client risk profiling | Remove screen + nav; keep `risk_assessments` dormant. |
| AUM Capital tab (`/v1/admin/capital-transactions`) | Spec §8: `capital_transactions` removed (no fake ledger) | Drop tab; AUM is `fund_aum_snapshots`. |
| Reconciliation ledger (`/v1/admin/reconciliation-ledger`) | Spec §8: `ledger_entries` removed | Replace with executions/payments reconciliation view. |
| SIP control requests queue (`/v1/admin/sip-control-requests`) | Spec §8: express as SIP commands + audit; high-risk → `approval_actions` | Rebuild as admin SIP commands over RA-C.9 lifecycle. |
| Payments approve/reject buttons | Confirmation is provider-webhook-driven (RA-C.8) | Payments screen becomes read/oversight only. |

## D. POSTPONED

| Item | Why |
|---|---|
| Support tickets | Out of MVP per spec (no schema). Leave stub/hidden. |
| Human KYC review queue | Email-OTP KYC auto-approves (RA-C.10); only needed if document KYC is added later (same `kyc_cases`). |

## E. Cross-cutting prerequisites

- **Maker-checker engine (`approval_actions`, 012).** Not built. Required by fund
  publication, NAV/AUM correction, booked-order reversal, above-threshold
  redemption, and RBAC changes (spec §5.2 closed set). Several A-items depend on
  it — build the approval-action execution core early, or scope the first fund
  slice to the *ordinary* (non-maker-checker) actions and add maker-checker next.
- **RBAC runtime management + admin-staff creation.** Only the bootstrap seed
  exists. Needed before multiple admins with scoped permissions are realistic.
- **Contract-first (CON-010/011/012).** Per the Session-1 model, admin route
  groups should update the shared Zod descriptors + generated OpenAPI before
  implementation.

## Proposed build order (highest leverage first)

1. **Fund pools / catalog (A)** — create fund → publish version + NAV + AUM +
   `return_tier`; admin list/detail; client fund listing (`GET /v1/client/funds`).
   *Unblocks the whole invest→book→holdings flow with real funds instead of test
   seeds.* Start with ordinary finance actions; layer maker-checker where the
   spec mandates it.
2. **Audit log viewer + admin oversight reads (A)** — cheap, high trust; surfaces
   the financial/onboarding evidence already recorded.
3. **Landing content: courses / plans / FAQs (A)** + the marketing-content
   modeling decision (B) → publish routes → wire the landing app to consume them.
4. **App config (A)** — reshaped presentation/feature-flags/min-version.
5. **User directory + lifecycle (A)** and, when needed, **RBAC/maker-checker (E)**.
6. **Cleanup (C):** remove obsolete screens/endpoints (risk profiles, capital,
   ledger, sip-control-requests, payment approve/reject).

Related: [[01-admin-audit-overview]] · [[02-landing-page-controls]] ·
[[03-client-app-controls]] · [[04-admin-internal-controls]] ·
[[../1/decisions/RISKS_AND_DECISIONS|Session 1 decisions]].
