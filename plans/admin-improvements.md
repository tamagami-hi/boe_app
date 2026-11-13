# BeOnEdge admin improvements: recording categories, receipts, value updates, returns, maturity, nominee, and fixes

Status: **Approved by the maintainer on 2026-11-13. Phase A is being implemented on four parallel tally tracks.** Every open question was answered on 2026-11-13 (decision record). What still needs the maintainer: the production reform's own destructive-change approval after the pre-flight report (D2), releases, and the payments re-enable decision. Checks run on the pinned Node 22.20.0 / npm 11.16.0 (tally `howto-1`).

Prepared: 2026-11-13. The investigation was static source reading only. No local checks ran (no dependencies are installed, and `RULES.md` forbids installing them just to make checks runnable). Nothing was diagnosed on a VPS, no test ran, no mail was sent, and nothing was deployed. GitHub CI run 38216879911 passed contracts, backend (including integration) and frontend on `ba8b196` (v0.15.4). The detailed evidence is held as tally records under `docs/records/`: findings `finding-1` to `finding-18` (excluding the retired `finding-5`), decisions `rule-2` to `rule-6`, and milestones `M1-admin-audit` and `M2-plan`.

Governing process: root [RULES.md](../RULES.md). The application is in production, so every schema change follows rule 11: expand first, nothing lost, released APKs and the previous release keep working. [The previous plan](app-onboarding-contact-investment-email.md) is complete through v0.15.4 and stays as history. Its open questions Q-013 and Q-017 remain there unless this plan says otherwise.

## 0a. Open questions and conservative defaults

IDs continue from the previous plan and are never reused. Q-017 and Q-019 to Q-025 were answered on 2026-11-13 and moved to the decision record. No question is open.

| ID | Open decision | Conservative behavior meanwhile |
| --- | --- | --- |
| None | | |

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
| 2026-11-13 | The integration suite may run in a local container with a throwaway PostgreSQL. | In force for lanes and phase closes (tally `rule-8`). |
| 2026-11-13 | Q-021: "Start a new SIP" means an admin-tracked schedule: monthly amount, fund, start month and number of months. Each monthly recording links to a month, and the client sees "N of M months paid". There is no automatic collection. The maturity date is per client fund holding. | Becomes C2 and C3 (tally `rule-8`). |
| 2026-11-13 | Q-024: two fixes. An audited admin contact correction for clients who have not set a password, which retires old links and sends the invite to the corrected address. Closed accounts can also release their email and phone. | Becomes step A8. Original contacts are kept in an append-only history (tally `rule-8`). |
| 2026-11-13 | Q-017 (revised): invite links stay short, at 10 minutes. Instead, the admin must be able to send a new invite in one obvious action, including after the old one expired or was cancelled. | Step A8 (tally `rule-9`). |
| 2026-11-13 | Q-025 (revised): setting a password does not verify the email. The email code step stays. | No change to verification (tally `rule-9`). |
| 2026-11-13 | Q-019 (revised): there is no standalone cleanup project. Reform or clean the database only when a change actually needs it, and only for client data. Nothing is lost, the step is rehearsed on dev against a masked copy, duplicate investments are reversed with both rows kept, and duplicate accounts are merged only for pairs the maintainer confirms. | Phase D runs only when needed. A production run still needs its own approval after the pre-flight report (tally `rule-9`). |
| 2026-11-13 | Q-020 (revised): client reviews are wanted, admin-only, but deferred. Fix bugs first. | E1 stays deferred (tally `rule-9`). |
| 2026-11-13 | Clients pay SIPs and investments directly to the company bank account, and the admin records them. Whether the gateway is on or off must not affect how quickly and clearly a client sees their investment in the app. | Recording, receipts, value updates and the client dashboard are the core path. Payments-off copy points to paying the BeOnEdge team directly (tally `rule-9`). |
| 2026-11-13 | The maintainer delegates: work out what else this kind of app needs, and simplify complex flows so both client and admin have a seamless experience. | Client and admin journey reviews (tally `M9-ux-review`) feed section 6 (tally `rule-9`). |
| 2026-11-13 | Q-022: the dashboards show simple return % as the main figure, plus annualised XIRR as a secondary column. | B5 (tally `rule-8`). |
| 2026-11-13 | Q-023: app-update announcement emails keep going to every active client. | No change (tally `rule-8`). |
| 2026-11-13 | Stay on Node 22. Production images already run `node:22.23.2`, and CI and the packages pin 22. Upgrading to Node 24 is a separate tested step. | Local checks use the official Node 22.20.0 and npm 11.16.0 in `~/.local/node-22.20.0`. The upgrade is task E3 (tally `howto-1`). |

#### Replaced

| Date | Earlier decision | Replaced by | Reason |
| --- | --- | --- | --- |
| 2026-11-13 | Q-017: invite links valid for 24 hours | Short links plus easy regeneration | Maintainer revised the same day |
| 2026-11-13 | Q-025: setting the password through the invite marks the email verified | Email code step stays | Maintainer revised the same day |
| 2026-11-13 | Q-019: a scheduled reform for duplicates and missing details | Reform only when a change needs it | Maintainer clarified the same day |
| 2026-11-13 | Q-020: reviews built after Phase B | Reviews deferred | Maintainer: bugs first |

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

### F. Experience review (client and admin, 2026-11-13)

The maintainer asked for a check of what else an app like this needs and where complexity can be simplified (tally `finding-19`, `finding-20`, `finding-21`). The main results:

- **Client side:**
  - Every payment the admin records tells the client it was made "before you joined the app".
  - Most notifications have no Open link.
  - Monthly payments are counted as one-off investments.
  - Money screens lack the market-risk footnote and the as-of date.
  - Support tickets reach nobody, while the client is told "we reply by email". Ticket references start with "BOE-".
  - SIP screens promise instalments in Activity that never appear.
  - Old pending payments poll forever.
  - Statements cannot be kept.
  - There is no "how to invest" guidance.
- **Admin side:** recording one payment takes about ten steps per client, with no bulk entry.
  - The ledger silently stops at 25 rows.
  - The collective preview shows raw IDs.
  - Some money inputs are in paise.
  - The investor record cannot be linked to.
  - The "Invited" filter never matches.
  - The mobile bar favours unused queues.
  - There is no support inbox, no single client page, no daily overview, no exports, and no structured bank reference for reconciliation.
- **Correction, tested by lane `a-payments-off`:** the SIP worker never created orders. Its request ID is not a valid identifier, so every pass throws. Its fixes join E2.

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
| A | `a-identity` | A8, after `a-onboarding` lands | createClientAccount, password credential, oversight routes, environment, migration 061, admin users feature |
| B | `b-receipts`, `b-value-updates`, `b-returns`, `b-email-web` | B1–B2, B3, B4–B5, B6 | Each adds its own contract file, so generated exports are regenerated at landing |
| C | `c-nominee`, `c-sip-maturity` | C1; then C2 → C3 | Migrations are numbered 061 (C1), 062 (C2), 063 (C3) |
| D | `d-data` | D1 → D2 | D1 can start now. D2's production run needs separate approval. |
| E | `e-reviews`; E2; E3 | E1 after Phase B; E2 after Phase C and before any payments re-enable; E3 when the maintainer chooses | Reviews use migration 065 |

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
- G11: write the "How to invest" FAQ with the bank details, and publish `featureFlags.onlinePayments=false` once B8 lands. Agents never invent bank details.
- G12: decide whether old pending online payments created before payments were turned off are expired, or left as they are.

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

  The identity changes answered by Q-017, Q-024 and Q-025 are step A8.
- **A8.** Identity follow-up, on lane `a-identity`, after A7 lands:
  - An audited admin contact correction for a client who has not set a password. It retires the old links and invites the corrected address.
  - An explicit, audited "release contacts" action on a closed account. The original email and phone are kept in a new append-only history table (migration 061), and the live columns are freed without breaking the previous release's lookups.
  - Sending a new invite is one obvious action on the user page and works after the old link expired or was cancelled. The invite lifetime stays at 10 minutes, and the email code step stays.
  - Tests cover each change, plus a populated-upgrade test for 061.

- **A9.** Client polish, on lane `a-client-polish`:
  - "Payment recorded" labels, and portfolio counts shown as payments
  - a shared money footnote with last updated and the market-risk line
  - date-only display for recorded payments
  - a failed eligibility read shown as "couldn't check", not "Locked"
  - tapping a notification opens it and marks it read
  - honest support copy, and `REQ-` ticket references for new tickets
  - Open links on reversal and payout notices

  Other lanes add Open links for recordings, value updates, maturity and SIP notices, neutral recording copy, the 100-row ledger with names in previews, rupee inputs, the collective confirm step, monthly reason codes, mobile navigation favouring Users, and hiding gateway-only admin sections when `featureFlags.onlinePayments` is false.

### Phase B — recording categories, receipts, value updates, returns

- **B1.** "Monthly investment" option and server-side category allow-list. Form wording, section titles and notification text follow the category instead of "before the app".
- **B2.** Client receipts endpoints and screen. New APK users open a receipt from the notification.
- **B3.** Value-update notification payload with `entryId` and `deepLink`. Client value-updates endpoint and screen.
- **B4.** Admin portfolio summary endpoints. Invested, value, return % and last updated on the users list and user detail. Links from the user page to the investor record, send email, and mandates.
- **B5.** ROI dashboard screen and route.
- **B6.** `CLIENT_WEB_APP_URL` lines in invite, approval and app-download emails. Reset-password screen copy that does not push the APK on web.
- **B3 extension.** A monthly value-update sheet per fund:
  - one row per client showing invested, current value and gain so far, with an input for "gain since investment"
  - the change is computed for each client and committed through the existing per-client preview and commit as one batch
- **B4 extension.**
  - A single client page: invite status with "send new link", summary, actions, and tabs for ledger (paged, with reverse), maturity, emails, support and sign-ins.
  - A daily overview: open tickets, invites not accepted, failed emails, and last value update per fund. Payment and maturity tiles are added in Phase C.
- **B7.** An admin support inbox:
  - a list with client name and reference, ticket detail, and a respond action (state plus resolution note)
  - each response is idempotent and audited, and notifies the client
  - a per-client ticket list
  - the client already shows status and the resolution note, so no client contract change is needed
- **B8.** Client investing guidance:
  - a "How to invest" card pointing to the maintainer-written FAQ
  - pay and invest buttons hidden when the published `featureFlags.onlinePayments` is false; today's behaviour is kept when the flag is absent
  - a single History list while payments are off
  - a printable statement view on the web

### Phase C — nominee, admin SIP schedule, maturity

- **C1.** Nominee migration, client and admin endpoints, Profile form, user page, audit. Populated-upgrade test for the new nullable columns.
- **C2.** Admin SIP schedule table and link, admin create/edit/close, monthly recording linked to a schedule month, and a client months-paid endpoint and badge.
- **C4.** A monthly payment sheet, after C2:
  - pick a month; one row per client and fund from the SIP schedule, with the expected amount, the amount already recorded, the date (today in IST by default) and a bank reference (UTR)
  - each row keeps its own idempotency key and shows its own result
  - CSV can be pasted into the sheet
  - the optional structured bank reference uses migration 066 and an optional request field
- **C5.** Accounting exports and a usable audit log:
  - client balances as of a date, and contributions by month with bank reference, built as CSV in the browser from new read endpoints
  - money-command presets with amounts and client links
  - a per-client audit list
- **C3.** Maturity schedule table, admin dashboard, due list, launch prompt, and the three resolutions built from existing settlement plus C2. Test: no resolution moves money or writes ledger rows without an explicit admin action, and each resolution is idempotent.

### Phase D — data (after Q-019)

- **D1.** A dev-only cleanup command that refuses to run against a production `NODE_ENV` or database. It keeps every client and investment record, and removes only what Q-019 names.
- **D2.** A read-only pre-flight report that the maintainer runs on production, and a one-time reform step rehearsed on dev against a masked copy. Registered as a rollback boundary in `release_manager/` with a populated-upgrade test before any production run.

### Phase E — later

- **E1.** Client reviews and comments, after Phase B lands:
  - a rating from 1 to 5 plus a comment, in a new table (additive migration)
  - a new client endpoint and screen
  - an admin-only list showing the client profile and a moderation state
  - nothing public
- **E3.** Upgrade to Node 24 LTS before Node 22 support ends in April 2027, as a separate tested runtime change:
  - Dockerfiles with pinned digests
  - the CI Node version
  - engines and `.nvmrc` in three packages
  - the release-manager runtime contract test
  - a check of native dependencies

  The maintainer decides the timing.
- **E2.** Before payments are re-enabled: the AutoPay due-date advance, stalled failed or refunded instalments, and mandate reconcile atomicity (section 2B).

## 7. Plan changes and approval gate

- Approval of this plan, of a phase, or of a step is the maintainer's. A proposal or default here is not approval.
- Phase D and any rewrite of existing rows need a separate explicit approval under rule 11, even after this plan is approved.
- Releasing the new screens needs a new client and admin APK export by the maintainer. Older APKs keep working and see plain notifications.
- Work runs on tally tracks with their own worktrees and lands on `main` through the tally landing queue. Records are committed once per phase.

## 8. Progress and handoff

Each step records here what changed, the exact verification (commands and counts), corrected beliefs, remaining risks, and what is unverified. Commits are referenced only after they exist.

### A8 identity follow-up (lane `a-identity`, commits `92d0e77`, `139ebd5`, `cd9b96d` and the security-review follow-ups after them)

- **Contact correction.** `POST /v1/admin/clients/{userId}/contact-correction` (`clients.create` and `clients.password_links.send`) corrects the email and/or phone of an active client account that holds no role and has not set a password, at the account version the admin read. A new email bumps `email_revision`, retires every outstanding password link and verification code, and queues a fresh invite to the corrected address only; the mail guard cancels mail still bound to the old revision. Nothing is sent to the old address. A phone-only correction sends nothing and keeps the link. Clashes return `STATE_CONFLICT` with per-field messages identical to create-client. Once a password is set the route refuses, and the client's own contact change applies.
- **Release.** `POST /v1/admin/users/{userId}/contact-release` (`users.close`) works only on a closed account without roles, once. It rewrites only the live `email_normalized` and `phone_e164` to unique placeholders (`released+<id>@released.invalid`, `+999` plus an 11-digit sequence number), which satisfy `users_live_pii_valid` and keep `users_email_uk`/`users_phone_uk` intact, so every previous-release lookup by email or phone still finds at most one account and finds the new account after re-creation. The account stays closed and keeps its name, ledger, orders, payments, audit and delivery rows. The previous release shows the placeholders for that account.
- **History.** `GET /v1/admin/users/{userId}/contact-history` (`users.read`) lists corrections and the release with the originals and actor. For a tombstoned account every contact in it is masked with the directory's tombstone values. Audit metadata holds masked email and phone endings only.
- **Security review follow-ups.** A client's contacts can be corrected at most 3 times in 24 hours (counted from `user_contact_history` under the user lock); a fourth attempt answers `RATE_LIMITED` with a retry time. The `+999` phone range and the `released.invalid` email domain are refused with field errors on correction and create-client, and the phone normaliser refuses `+999` for the client's own phone change too. A release also retires leftover email verification codes and pending email-change requests.
- **Invite regeneration.** The existing `POST /v1/admin/clients/{userId}/password-link` already retires older links and works after expiry or a cancelled email. The user page now labels it "Send a new invite link" for clients without a password and explains why the current invite cannot be used. The cooldown now counts only links bound to the current email revision. Invite lifetime and the email code step are unchanged.
- **Migration 061** (`061_user_contact_history.sql`, renumbered from 064 by the coordinator so production applies migrations in order with no gap) adds a sequence and the append-only `user_contact_history` table (update, delete and truncate refused by triggers). It touches no existing row, and the previous release (v0.15.x) runs against it unchanged. It is not a destructive boundary. Tests: `userContactHistoryMigration` (populated upgrade plus previous-release lookups after a release), `adminClientContacts` (14 cases), and `releaseUpgrade` now expects 061.
- **Verification (TESTED, Node 22 container, on `a9b3ee6` with the review follow-ups):** contracts check 98 tests; backend check 98 files / 1180 tests; integration 40 files / 422 tests with coverage disabled as in CI; frontend check 27 files / 241 tests plus `build:admin` (`build:client` last ran before the follow-ups, which do not touch client code). Negative controls: removing the password-set refusal or the revision-scoped cooldown failed 3 integration tests; removing the correction cap, the tombstone masking or the `+999` refusal failed 3 more.
- **Not verified:** no browser run of the new user-page sections, no real mail, nothing on a VPS. Closed administrator accounts cannot release their contacts; the directory search does not match previous contacts. Each later migration must add itself to the `releaseUpgrade` expectation.
