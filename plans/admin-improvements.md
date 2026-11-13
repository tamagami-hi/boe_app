# BeOnEdge admin improvements: recording categories, receipts, value updates, returns, maturity, nominee, and fixes

Status: **Approved by the maintainer on 2026-11-13. Implementation starts with Phase A on four parallel tally tracks.** Steps that wait on an open question stay blocked until it is answered: identity changes (Q-017, Q-024, Q-025), C2 and C3 (Q-021), Phase D (Q-019, plus its own destructive-change approval), and E1 (Q-020). The container-based integration suite still needs the maintainer's permission.

Prepared: 2026-11-13. The investigation was static source reading only. No local checks ran (no dependencies are installed, and `RULES.md` forbids installing them just to make checks runnable). Nothing was diagnosed on a VPS, no test ran, no mail was sent, and nothing was deployed. GitHub CI run 38216879911 passed contracts, backend (including integration) and frontend on `ba8b196` (v0.15.4). The detailed evidence is held as tally records under `docs/records/`: findings `finding-1` to `finding-18` (excluding the retired `finding-5`), decisions `rule-2` to `rule-6`, and milestones `M1-admin-audit` and `M2-plan`.

Governing process: root [RULES.md](../RULES.md). The application is in production, so every schema change follows rule 11: expand first, nothing lost, released APKs and the previous release keep working. [The previous plan](app-onboarding-contact-investment-email.md) is complete through v0.15.4 and stays as history. Its open questions Q-013 and Q-017 remain there unless this plan says otherwise.

## 0a. Open questions and conservative defaults

IDs continue from the previous plan and are never reused. Tally question rows are given for cross-reference.

| ID | Open decision | Conservative behavior meanwhile |
| --- | --- | --- |
| Q-019 | Data reform (tally row 9): what is wrong in today's production data that the one-time step must fix, and may real client data be copied to dev unmasked? | Phase D designs only an additive path: new rows, never edits, plus a read-only pre-flight report that the maintainer runs. PII on dev is assumed masked. Nothing in Phase D is written until this is answered. |
| Q-020 | Client app reviews and comments, DD point 1 (tally row 10): still wanted, and visible to admins only or to other clients too? | Kept as a later phase (E1): an admin-only list, nothing public. |
| Q-021 | Admin-tracked SIP and maturity scope (tally row 11): with payments off, does "start a new SIP" mean an admin-defined expected monthly amount, fund and start date that monthly recordings link to? Is the maturity date per fund holding or per individual investment? | An admin SIP schedule with no gateway collection; monthly recordings link to it; one maturity date per client and fund. |
| Q-022 | Return figure on the dashboards: simple return (growth ÷ invested) or annualised (XIRR)? | Simple return %, the same formula the client portfolio already uses (`portfolioLedger.ts:60-68`). |
| Q-023 | Should APK update announcements keep going to clients who use only the web app or an iPhone? | Unchanged: every active client receives them. |
| Q-024 | How the admin corrects a mistyped email or phone on a client who has not set a password yet: an admin contact-correction action (audited, old links retired), and/or freeing a closed account's contacts | No change to identity rules. A7 only adds a review step before the invite is queued. |
| Q-017 (carried) | A separate, longer lifetime for admin invite links than the 10-minute email-code lifetime they share today. The value is the maintainer's; it is not invented here | Unchanged at 10 minutes. The handoff warns that a mail outage of more than about six minutes cancels an invite, and the admin can resend. |
| Q-025 | Whether setting the password through the emailed link should also mark that email verified, so a new client needs no second email code | Unchanged: the client still verifies with a code. |

### Decision record

| Date | Maintainer decision | Status |
| --- | --- | --- |
| 2026-11-13 | Plan approved ("Yes I do", in answer to approving the plan, committing it, and starting Phase A on tally tracks with their own worktrees). | In force. It covers opening tally tracks and worktrees and installing locked dependencies in them for checks. It does not cover a container runtime, deployments, APK exports, real customer mail, or Phase D's destructive step. |
| 2026-11-13 | AutoPay and normal online payments are turned off for now and stay disabled until the maintainer decides to activate them. | In force. Agents never enable payments or change payment configuration. AutoPay defects are fixed before any re-enable, not urgently (tally `rule-2`). |
| 2026-11-13 | Data cleanup: the dev server may be cleaned, but client records and investment records stay intact on both dev and production. Production holds real clients. Save a copy of the required production information, and in the next deployed update run a one-time migration or copy step that reforms the data without losing any of it. Rehearse that step on dev first. | Direction recorded. Details wait on Q-019. The maintainer performs every production export and deploy. A rewrite or backfill is a rule 11 destructive change, needing its own approval with a pre-flight check (tally `rule-3`). |
| 2026-11-13 | When the admin records an investment, the client sees it as a receipt labelled with the category the admin chose. | Becomes steps B1–B2 (tally `rule-4`). |
| 2026-11-13 | No automatic maturity. The admin enters a maturity date. A maturity management dashboard lists them. As a date nears, the admin is prompted every time the admin app opens to resolve it by returning all the money to the client, recording it as a one-time investment from the maturity date and starting a new SIP from then, or reinvesting it as a SIP. Every recording counts, and the admin manages them. | Becomes step C3. Option wording is refined by Q-021 (tally `rule-5`). |
| 2026-11-13 | Nominee: the nominee's name and their relation to the account holder. | Becomes step C1 (tally `rule-6`). |
| 2026-11-13 | Public signups are not in use. Clients are onboarded only by the admin, so redirecting signups to app.beonedge.in (DD point 3) is not pursued. The onboarding process is audited for bugs instead. | DD point 3 is dropped. Onboarding audit results are in section 2E (tally `rule-6`). |
| 2026-11-13 | The signup application review stays as it is. Admin onboarding works well and does not go through review. | No change to application review (tally `rule-6`). |
| 2026-11-13 | AutoPay is not activated until the maintainer says so. | AutoPay on the web is not pursued (tally `rule-2`, `rule-6`). |
| 2026-11-13 | Value updates are entered monthly as the amount gained since investment. Each update is kept as a record, and the client is notified every time their investment is updated. | Becomes step B3 (tally `rule-6`). |

#### Replaced

None yet.

## 1. Requested outcomes

| Source | Request | Disposition |
| --- | --- | --- |
| Maintainer | "Add monthly investment" next to "Add earlier investment" and "Add correction" | B1 |
| DD 1 | Client app reviews and comments, with the client's profile | E1, waiting on Q-020 |
| DD 2 | Full web app | Mostly built already; small gaps in B6 |
| DD 3 | Redirect beonedge.in signups to app.beonedge.in | Dropped (decision record) |
| DD 4 | app.beonedge.in link in the invitation email, for iPhone and desktop users | B6 |
| DD 5 | Nominee name | C1 |
| DD 6 | Maturity after 12 months, and a visible count of SIP months paid | Replaced by the maturity decision: C3, plus C2 for months paid |
| DD 7 | Invested amount and returns per client on the user pages | B4 |
| DD 8 | After updating client values, a dashboard of overall ROI and each client's returns, with last-updated date and time | B3 and B5 |
| DD cleanup | One-click cleanup of the user database | Replaced by the cleanup decision: D1 and D2 |

## 2. Findings and evidence

All findings are `STATIC` unless marked otherwise. "Verified" means the claim was re-read in source after the explorer reported it.

### A. Verified defects to fix first

1. **Individual client growth can be appended twice.** `useIndividualClientGrowth` mints a new idempotency key on every attempt (`frontend_stack_ts/src/features/admin/shared/adminQueries.ts:598`). `AdminIndividualClientGrowthBody` has no version guard (`packages/contracts/src/operations/admin-money.ts:46-55`). A retry after a timeout, or a second click on the still-filled form, adds a second growth entry, which breaks rule 6. The timeout path tells the admin "Nothing has changed", which may be false. On success only `["admin","users"]` is invalidated (`:602`, `:722`), so positions stay stale. The collective commit (`:718`) needs the same check (`finding-9`).
2. **Failed reads render as empty or "Not set"**, which breaks rule 4:
   - `ClientPositionDetailScreen.tsx:80-81` (positions and ledger), `IndividualClientGrowthScreen.tsx:77,84-86`, `MaturityPanel.tsx:40,96,103`, `CollectiveAumGrowthScreen.tsx:91,191`, `CollectiveClientGrowthScreen.tsx:52`, the fund and template pickers, and the client comboboxes.
   - `FundAumScreen.tsx:67-111` offers "Set opening AUM" when the fund read fails.
   - The overview tiles render a failure as "—" (`finding-10`).
3. **Payments are off, but unpayable orders keep being created.**
   - The SIP worker runs without a gateway (`workerComposition.ts:294-317`). It creates one instalment order per due period and notifies "Open the app to pay it" (`createSipInstallmentOrder.ts:77-84`), then waits on that order forever (`sipScheduleWorker.ts:99-104`).
   - Clients can still create lump-sum orders and SIPs (`clientOrderRoutes.ts:93-135`, `clientSipPlanRoutes.ts:62-112`). Only payment refuses, with `DEPENDENCY_UNAVAILABLE` (`clientOrderRoutes.ts:154-156`).
   - No client reads the published `featureFlags` (`finding-15`).
4. **App-config publish has no version guard.** It computes `max(version)+1` (`adminContentRoutes.ts:438-480`), and its idempotency key is optional. Two simultaneous publishes collide on the unique version. A publish from a stale screen can silently lower a `minimumSupportedVersion` that a required update announcement just raised (`finding-12`).
5. **Date handling.**
   - Growth `effectiveDate` is checked by regex only, so `2026-13-45` reaches Postgres. Growth and AUM dates have no future-date guard.
   - The "not in the future" checks for recorded contributions and maturity use the UTC day. Between 00:00 and 05:30 IST, today is refused, which will hit monthly recordings made early in the morning (`finding-13`, `finding-3`).
6. **Smaller admin defects** (`finding-11`):
   - Mandate amounts are `z.number()` and the screens divide them by 100 (`MandateListScreen.tsx:113`, `MandateDetailScreen.tsx:99,252`).
   - "Nothing changed" is shown on transport errors without the unknown-outcome check (`UserDetailScreen.tsx:76-111`, application, refund and receipt screens).
   - Some permission gating is wrong. This matters little while one superadmin holds every role (Q-007 in the previous plan).

### B. Defects that stay dormant while payments are off

These must be fixed before the maintainer re-enables payments. They are not part of the first release:

- AutoPay `next_due_date` never advances after a scheduled debit, because `prepareCollection` returns early once `now >= debitAt` (`mandateCollectionWorker.ts:90`), before the only advance (`:95-101`). Verified (`finding-6`).
- A failed, refunded or cancelled instalment stalls its plan permanently.
- Mandate reconcile commits its state change in a nested transaction, apart from the audit row and the idempotency receipt (`adminMandateRoutes.ts:371`, `reconcileMandateFacts.ts:94`). Verified (`finding-12`).

### C. Compatibility constraint (verified)

Client and admin responses are `z.strictObject` throughout, and `http.ts:296-302` rejects any mismatch for the whole call. Released v0.14.7 behaves the same way. So a new key on an existing response, or a new value in an existing response enum, breaks released APKs. Affected enums include `OrderType`, `LedgerEntryType`, `SipState` and `AdminMaturity.settlement`.

Notification `kind` is `z.string()` and `payload` is an open record, so they tolerate new values. Error codes are not checked per operation. **New data therefore reaches apps only through new endpoints and new notification payload keys** (`finding-14`).

### D. What already exists and is reused

- **Recording:** `recordContribution` with the Idempotency-Key durable receipt, writing a `recorded_offline` order, a succeeded payment, an allocation, a contribution ledger entry, an audit event and a notification. `reasonCode` is free text, stored on `client_value_entries` and never shown to clients (`finding-3`, `finding-16`).
- **Growth:** individual and collective growth already keep a `client_growth_batches` row plus one `growth_adjustment` ledger entry per client. Both already write a `client_value_updated` notification, with fixed text and payload `{fundId}` and no deep link (`finding-16`).
- **Returns:** `derivePortfolio` computes invested, value, growth, return % and last activity date for client routes. The admin per-fund positions endpoint has no total, no return % and no timestamp (`finding-2`).
- **Maturity:** settlement exists per client and fund (`051`). It has `withdrawal` with an external payout record, and `reinvestment`, which only moves growth into principal and refuses when there is no growth. There is no planned maturity date anywhere (`finding-4`, `finding-16`).
- **Web app:** app.beonedge.in already serves the client app with cookie authentication. The web gaps are no PIN or biometric lock, no update prompt, statements on screen only, AutoPay refused, and a reset-password screen that pushes the APK first (`finding-7`).
- **Email:** every client email carries only password and APK links, and `EmailTemplateConfig` holds only the support address (`finding-7`).
- **Data:** there is no delete or anonymise code. 63 foreign keys reference `users`, mostly `RESTRICT`. Audit and login events have no foreign key and keep personal data. Local throwaway reset exists only in `test_e2e/local-stack.sh` (`finding-8`, `finding-13`).

### E. Onboarding audit (admin-created clients)

What works: the create form keeps one idempotency key across retries, and the server keeps a durable receipt. Duplicates are checked under identity locks backed by unique constraints. A resend retires the older link, and the email worker cancels mail for a superseded link. Earlier investment is a separate request after creation, by design (`finding-17`, `finding-18`).

Defects, verified unless marked:

1. **A mistyped email cannot be corrected.**
   - The set-password link is queued as soon as the client is created, with no confirm step (`CreateClientScreen.tsx:72-89,216`).
   - No admin route edits a client's email or phone.
   - `users_email_uk` and `users_phone_uk` are unique across every account state (`010_canonical_identity.sql:33-34`). Migration 056 freed only contacts held by signup applications. So whoever owns the mistyped inbox can take the account, and closing it never frees the phone number for a corrected re-creation (Q-024).
2. **The invite link can expire before mail retries finish.** The set link uses the shared 10-minute email-code lifetime, while mail retries wait 1, 5 and then 15 minutes. The guard cancels mail for an expired link, so an email outage of more than about six minutes silently cancels the invite. The email says "10 minutes" counted from when the link was issued, not sent (Q-017, carried from the previous plan).
3. **Setting the password does not verify the email.** The link already proves the inbox at the current email revision, yet the client must still enter an emailed code before investing (Q-025).
4. **The client app gives wrong messages while payments are off.**
   - AutoPay refuses before saving anything (`clientAutoPaySipRoutes.ts:375-381`), but the copy says "Your SIP is saved and waiting for authorisation" (`failure.ts:163-166`).
   - A lump-sum order is created, and then payment always fails.
   - Both are covered by A3 plus copy changes.
5. **A failed eligibility read looks like an unverified email.** The client is redirected to verify their email. "Email me a code" while already verified shows "Code sent" (`guards.tsx:110-116`, `queries.ts:311-313`).
6. **Admin screens:**
   - The earlier-investment fund picker is silently empty on a failed read.
   - The user page says "Nothing changed" after a timeout, and suspend or close mints a new key per attempt (`adminQueries.ts:190`).
   - The directory shows an invitee who never set a password as active.
7. **The onboarding harness is stale and not in CI.** `test_e2e/onboarding-e2e.mjs:202-214` calls the removed `/v1/client/kyc/*` routes and old status values. `onboarding-harness.test.mjs:41` expects copy that was removed.
8. **Expired links are a dead end, and the screens push the APK.** An expired link offers no "request a new link". The password success screen pushes the Android APK, and an app-download email is queued on every set or reset.
9. **Likely, needs a test:**
   - A set-password retry after a dropped success gets "link no longer valid".
   - The password-link panel's unknown state has no way out after its receipt expires.
   - `recordContribution` does not check the account state.
   - A phone clash is reported against the email field.
   - A `+91` number of the wrong length is accepted.

Nothing tests the whole admin-created journey: create, set the password, client sign-in on web and APK, email code, eligibility.

## 3. Recommended design

| Area | Recommended behavior |
| --- | --- |
| Recording categories | Categories: earlier investment, monthly investment and correction. Only these values are accepted server-side. The category is derived from the stored `reason_code` at read time, so old rows need no backfill. Monthly investment adds principal and value equally, like an earlier investment. Correction stays add-only, and a decrease remains a reversal. |
| Client receipt | New `GET /v1/client/receipts` and `GET /v1/client/receipts/{entryId}`, and a new receipts screen. Each receipt shows category label, fund, amount, effective date, recorded time and, when linked, SIP schedule and month. Existing Activity, Payments and Portfolio responses do not change. |
| Recording notification | Keep kind `client_contribution_recorded`. The server writes title and body per category, and the payload gains `entryId`, `orderId`, `category` and `deepLink: "/activity"`. "/activity" exists in every released APK. New APKs open the receipt from `entryId`. |
| Value updates | Every growth entry stays a ledger record, as today. The notification payload gains `entryId` and `deepLink`, and the body states that the fund value was updated, without amounts as today. New `GET /v1/client/value-updates` lists date, fund, change and value after. An email copy is optional and off unless the maintainer asks. A zero-change client still gets no entry. |
| Per-client returns (DD 7) | New `GET /v1/admin/clients/{userId}/portfolio-summary` and a paged `GET /v1/admin/client-values/summary`. Each gives invested, current value, growth, return % and last updated (latest ledger `created_at`). The users list and user detail read them. Existing `AdminUser` responses are not changed. |
| ROI dashboard (DD 8) | A new admin screen over the summary endpoint: totals across clients, a per-client table sortable by return, and last-updated time. The module reads only client value entries and is named outside the AUM and client-growth paths that the walls guard test checks. Fund AUM is not reconciled with it. |
| Admin SIP schedule | A new `admin_sip_schedules` table (client, fund, monthly amount in paise, start month, months, state, actor, version) and a link from each monthly recording to schedule and month, unique per month. No gateway, no worker and no client controls. The client sees "N of M months paid" through a new endpoint. |
| Maturity schedule | A new `client_maturity_schedules` table per client and fund: maturity date (future allowed), state, chosen resolution, links to the settled maturity and any follow-up SIP schedule, actor and version. A new admin dashboard lists upcoming and due dates. A signed-in admin prompt in `AdminFrame` calls `GET /v1/admin/maturities/due` each launch and can be dismissed only for that launch. The resolutions reuse the existing settlement: withdrawal for "return all money"; for "one-time investment from maturity date plus new SIP", record the matured value as a new one-time investment receipt, then create an admin SIP schedule (exact ledger form fixed with Q-021); for "reinvest as SIP", create an admin SIP schedule funded from the matured value. The existing `settlement` enum is never extended. |
| Nominee | Nullable `users.nominee_name` and `users.nominee_relation`, with control-character and length checks like `full_name`. The client edits them in Profile through a new endpoint, the admin edits them on the user page, and every change is audited. Tombstoning clears them. Existing profile and user responses are not changed; new endpoints serve the values. |
| Invitation and approval email (DD 4) | A new optional `CLIENT_WEB_APP_URL` setting. When set, invite, approval and app-download emails add a line for iPhone and computer users to open the web app. It is filled in at render time, so queued payloads are unaffected. |
| Payments off | Order and SIP creation return `DEPENDENCY_UNAVAILABLE` when no payment gateway is configured. The SIP worker creates no instalment order without one. Released APKs already show this code's "temporarily unavailable" copy. |

## 4. Non-negotiable implementation invariants

- Follow root `RULES.md`. No source comments. Tests only where a failure would be costly (rule 10): money arithmetic, idempotency and duplicate writes, authorization, migrations over existing rows, and payments-off refusals.
- **Compatibility:** no new key on an existing client or admin response and no new value in an existing response enum. New data comes through new operations and notification payload keys. New contract operations ship with backend routes, generated OpenAPI and operation exports in the same step.
- **Schema:** migrations are expand-only. New tables and nullable columns are ignored by the previous release (v0.15.x). No backfill of existing ledger, order, payment, audit, consent, application or delivery rows. Phase D's reform is the only data rewrite and needs its own approval.
- **Money:** integer paise strings over the API and integer arithmetic in the domain. Portfolio values stay ledger-derived. Fund-AUM and client-growth walls stay intact.
- **Writes:** every admin money write carries a caller-held idempotency key, reused on retry. An unknown outcome is shown as unknown, never as "nothing changed".
- **Reads:** a failed read shows an explicit failure and recovery, never an empty table or "Not set".
- **Payments:** nothing in this plan enables payments or AutoPay or changes payment configuration.
- **Mail:** new email text is rendered at send time from configuration, and no real customer mail is sent for verification.
- **Configuration:** new keys go into tracked examples and compose passthrough and are listed in the handoff. A missing key disables only its feature, explicitly.

## 5. Dependency order

```text
Phase A  fixes, no schema        A1 growth idempotency ─┐
                                 A2 failed-read states  │
                                 A3 payments-off guards │
                                 A4 app-config guard    │
                                 A5 date handling       │
                                 A6 smaller admin fixes │
                                 A7 onboarding fixes    │
Phase B  recording and returns   B1 categories ─ B2 receipts
                                 B3 value updates (after A1)
                                 B4 per-client summary ─ B5 ROI dashboard
                                 B6 web link in email, web copy
Phase C  schema features         C1 nominee
                                 C2 admin SIP schedule ─ C3 maturity schedule and prompt
Phase D  data (after Q-019)      D1 dev cleanup keeping records
                                 D2 production pre-flight export and one-time reform, rehearsed on dev
Phase E  later                   E1 reviews (Q-020); E2 AutoPay and mandate fixes before any re-enable
```

Phases A and B need no migration. C1, C2 and C3 add tables or nullable columns. Each phase can ship on its own, with A first.

### Parallel lanes (tally tracks)

Each lane is a tally track `track/<name>` with its own worktree. Lanes in the same phase run in parallel and land one at a time through the tally queue. The board (milestones `M3-gates` to `M8-phase-e`) is the live view.

| Phase | Lane | Steps | Own files |
| --- | --- | --- | --- |
| A | `a-client-values` | A1, A2 (client values), A5 (growth and AUM dates) | admin client-values feature, growth and AUM routes |
| A | `a-payments-off` | A3 | client order and SIP routes, SIP worker, client failure copy |
| A | `a-admin-core` | A2 (other admin screens), A4, A6 | fund-aum, overview, mandates, applications, refunds, receipts, app-config, emails, admin shell, app-config route and contract |
| A | `a-onboarding` | A7, A5 (IST today) | admin users feature, client auth and email verification, guards, recordContribution, createClientAccount, maturity settlement date, onboarding harness and CI |
| B | `b-receipts`, `b-value-updates`, `b-returns`, `b-email-web` | B1–B2, B3, B4–B5, B6 | Each adds its own contract file, so generated exports are regenerated at landing |
| C | `c-nominee`, `c-sip-maturity` | C1; then C2 → C3 | Migrations are numbered 061 (C1), 062 (C2), 063 (C3) |
| D | `d-data` | D1 → D2 | After Q-019 and separate approval |

Shared-file rules:
- `adminQueries.ts` is at 725 of 800 lines. A lane moves the hooks it changes into its feature's own query module instead of growing the file.
- `packages/contracts/src/operations/admin-money.ts` is already over 800 lines. Phase A does not touch it, and later lanes add new contract files.
- `runtime/composition.ts` is at 765 lines. A lane that must register a route there keeps the addition small, or adds a composition module as `adminEmailComposition.ts` does.

Maintainer gates (milestone `M3-gates`):
- G1: plan approval.
- G2: permissions, including the container runtime.
- G3–G6: answers to the open questions.
- G7 and G8: dev and production releases.
- G9: the production pre-flight run.
- G10: the payments re-enable decision.

## 6. Construction steps

### Phase A — fixes

- **A1.** The individual and collective growth forms hold one idempotency key per logical submit and reuse it on retry. The form locks after success and an unknown outcome is shown honestly. Investor positions and the ledger are invalidated on success. Server side, the growth body's paise and date parsing is aligned with the contract. Test: retrying with the same key appends once, and a new key after success is the only way to append again.
- **A2.** Every admin read listed in 2A.2 gets explicit loading, failure and empty states. The fund AUM form appears only after a successful read shows no AUM. Overview tiles distinguish failure and missing permission from loading.
- **A3.** Order and SIP creation refuse with `DEPENDENCY_UNAVAILABLE` when the payment gateway is absent, and the SIP worker skips creation. Test: with no gateway, creation is refused, no order or notification is written, and the worker creates nothing. Existing unpaid instalment orders are left as recorded. Whether to retire them is a separate maintainer decision.
- **A4.** App-config publish requires the version it was edited from and rejects a stale publish with a conflict code that the admin screen explains. Test: a stale publish cannot lower `minimumSupportedVersion`.
- **A5.** "Today" for recordings and maturity means the IST calendar day. Growth and AUM dates are parsed as real calendar dates, with a future-date guard.
- **A6.** Mandate screens format paise exactly, without float division. The unknown-outcome check is added where it is missing. The client-values entry points use the same permissions as their routes.
- **A7.** Onboarding fixes from section 2E:
  - a review step on create-client that shows the email before the invite is queued
  - field-level duplicate errors, with phone length checked for `+91`
  - an account-state check in `recordContribution`
  - honest unknown-outcome handling and a single held key on the user page and the password-link panel
  - an explicit failure state for eligibility instead of the verify-email redirect, and honest copy for "already verified"
  - a "request a new link" action on the expired-link screen
  - web-neutral password success copy
  - payments-off copy for lump sum and AutoPay
  - invitees without a password labelled as invited in the directory
  - a repaired onboarding harness wired into CI

  Q-017, Q-024 and Q-025 change identity rules, so their fixes wait for answers.

### Phase B — recording categories, receipts, value updates, returns

- **B1.** "Monthly investment" option and server-side category allow-list. Form wording, section titles and notification text follow the category instead of "before the app".
- **B2.** Client receipts endpoints and screen. New APK users open a receipt from the notification.
- **B3.** Value-update notification payload with `entryId` and `deepLink`. Client value-updates endpoint and screen.
- **B4.** Admin portfolio summary endpoints. Invested, value, return % and last updated on the users list and user detail. Links from the user page to the investor record, send email, and mandates.
- **B5.** ROI dashboard screen and route.
- **B6.** `CLIENT_WEB_APP_URL` lines in invite, approval and app-download emails. Reset-password screen copy that does not push the APK on web.

### Phase C — nominee, admin SIP schedule, maturity

- **C1.** Nominee migration, client and admin endpoints, Profile form, user page, audit. Populated-upgrade test for the new nullable columns.
- **C2.** Admin SIP schedule table and link, admin create/edit/close, monthly recording linked to a schedule month, and a client months-paid endpoint and badge.
- **C3.** Maturity schedule table, admin dashboard, due list, launch prompt, and the three resolutions built from existing settlement plus C2. Test: no resolution moves money or writes ledger rows without an explicit admin action, and each resolution is idempotent.

### Phase D — data (after Q-019)

- **D1.** A dev-only cleanup command that refuses to run against a production `NODE_ENV` or database. It keeps every client and investment record, and removes only what Q-019 names.
- **D2.** A read-only pre-flight report that the maintainer runs on production, and a one-time reform step rehearsed on dev against a masked copy. Registered as a rollback boundary in `release_manager/` with a populated-upgrade test before any production run.

### Phase E — later

- **E1.** Client reviews and comments, once Q-020 is answered.
- **E2.** Before payments are re-enabled: the AutoPay due-date advance, stalled failed or refunded instalments, and mandate reconcile atomicity (section 2B).

## 7. Plan changes and approval gate

- Approval of this plan, of a phase, or of a step is the maintainer's. A proposal or default here is not approval.
- Phase D and any rewrite of existing rows need a separate explicit approval under rule 11, even after this plan is approved.
- Releasing the new screens needs a new client and admin APK export by the maintainer. Older APKs keep working and see plain notifications.
- Work runs on tally tracks with their own worktrees and lands on `main` through the tally landing queue. Records are committed once per phase.

## 8. Progress and handoff

Each step records here what changed, the exact verification (commands and counts), corrected beliefs, remaining risks, and what is unverified. Commits are referenced only after they exist.
