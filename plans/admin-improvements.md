# BeOnEdge admin improvements: recording categories, receipts, value updates, returns, maturity, nominee, and fixes

Status: **Approved by the maintainer on 2026-11-13. Phases A, B and C, and Phase E steps E1 and E2, are complete on local `main` (not pushed or released). Phase D and E3 wait for the maintainer. Phases F and G are complete on local `main` (section 8). Nothing from Phases A to G is pushed or released. Phase H is being built.** No question is open. What still needs the maintainer: publishing `featureFlags.onlinePayments=false` (G11), the production reform's own destructive-change approval after the pre-flight report (D2), releases, and the decision to resume payments. Checks run in the pinned Node 22.20.0 / npm 11.16.0 container `tools/node22-container/run.sh` (tally `howto-2`).

Prepared: 2026-11-13. The investigation was static source reading only. No local checks ran (no dependencies are installed, and `RULES.md` forbids installing them just to make checks runnable). Nothing was diagnosed on a VPS, no test ran, no mail was sent, and nothing was deployed. GitHub CI run 38216879911 passed contracts, backend (including integration) and frontend on `ba8b196` (v0.15.4). The detailed evidence is held as tally records under `docs/records/`: findings `finding-1` to `finding-18` (excluding the retired `finding-5`), decisions `rule-2` to `rule-6`, and milestones `M1-admin-audit` and `M2-plan`.

Governing process: root [RULES.md](../RULES.md). The application is in production, so every schema change follows rule 11: expand first, nothing lost, released APKs and the previous release keep working. [The previous plan](app-onboarding-contact-investment-email.md) is complete through v0.15.4 and stays as history. Its open questions Q-013 and Q-017 remain there unless this plan says otherwise.

## 0a. Open questions and conservative defaults

IDs continue from the previous plan and are never reused. Q-017 and Q-019 to Q-025 were answered on 2026-11-13, and Q-027 to Q-029 on 2026-11-14; all are in the decision record. Q-026 and Q-030 to Q-032 were answered on 2026-11-14 (DEC-29 to DEC-32). Q-036 was answered on 2026-11-14 (DEC-36). Tally question rows 1 to 22 are marked answered, each citing its decision ID. No question is open.

| ID | Open decision | Conservative behavior meanwhile |
| --- | --- | --- |
| — | No open questions. | — |

### Decision record

| ID | Date | Maintainer decision | Status |
| --- | --- | --- | --- |
| DEC-21 | 2026-11-13 | Plan approved ("Yes I do", in answer to approving the plan, committing it, and starting Phase A on tally tracks with their own worktrees). | In force. It covers opening tally tracks and worktrees and installing locked dependencies in them for checks. It does not cover a container runtime, deployments, APK exports, real customer mail, or Phase D's destructive step. |
| DEC-22 | 2026-11-13 | AutoPay and normal online payments are turned off for now and stay disabled until the maintainer decides to activate them. | In force. Agents never enable payments or change payment configuration. AutoPay defects are fixed before any re-enable, not urgently. |
| DEC-1 | 2026-11-13 | Data cleanup: the dev server may be cleaned, but client records and investment records stay intact on both dev and production. Production holds real clients. Save a copy of the required production information, and in the next deployed update run a one-time migration or copy step that reforms the data without losing any of it. Rehearse that step on dev first. | Direction recorded; its scope is set by the Q-019 row below. The maintainer performs every production export and deploy. A rewrite or backfill is a rule 11 destructive change, needing its own approval with a pre-flight check. |
| DEC-2 | 2026-11-13 | When the admin records an investment, the client sees it as a receipt labelled with the category the admin chose. | Becomes steps B1–B2. |
| DEC-3 | 2026-11-13 | No automatic maturity. The admin enters a maturity date. A maturity management dashboard lists them. As a date nears, the admin is prompted every time the admin app opens to resolve it by returning all the money to the client, recording it as a one-time investment from the maturity date and starting a new SIP from then, or reinvesting it as a SIP. Every recording counts, and the admin manages them. | Becomes step C3. Option wording is refined by Q-021. |
| DEC-4 | 2026-11-13 | Nominee: the nominee's name and their relation to the account holder. | Becomes step C1. |
| DEC-5 | 2026-11-13 | Public signups are not in use. Clients are onboarded only by the admin, so redirecting signups to app.beonedge.in (DD point 3) is not pursued. The onboarding process is audited for bugs instead. | DD point 3 is dropped. Onboarding audit results are in section 2E. |
| DEC-5 | 2026-11-13 | The signup application review stays as it is. Admin onboarding works well and does not go through review. | No change to application review. |
| DEC-7 | 2026-11-13 | AutoPay is not activated until the maintainer says so. | AutoPay on the web is not pursued. |
| DEC-8 | 2026-11-13 | Value updates are entered monthly as the amount gained since investment. Each update is kept as a record, and the client is notified every time their investment is updated. | Becomes step B3. |
| DEC-17 | 2026-11-13 | The integration suite may run in a local container with a throwaway PostgreSQL. | In force for lanes and phase closes. |
| DEC-9 | 2026-11-13 | Q-021: "Start a new SIP" means an admin-tracked schedule: monthly amount, fund, start month and number of months. Each monthly recording links to a month, and the client sees "N of M months paid". There is no automatic collection. The maturity date is per client fund holding. | Becomes C2 and C3. |
| DEC-10 | 2026-11-13 | Q-024: two fixes. An audited admin contact correction for clients who have not set a password, which retires old links and sends the invite to the corrected address. Closed accounts can also release their email and phone. | Becomes step A8. Original contacts are kept in an append-only history. |
| DEC-11 | 2026-11-13 | Q-017 (revised): invite links stay short, at 10 minutes. Instead, the admin must be able to send a new invite in one obvious action, including after the old one expired or was cancelled. | Step A8. |
| DEC-12 | 2026-11-13 | Q-025 (revised): setting a password does not verify the email. The email code step stays. | No change to verification. |
| DEC-1 | 2026-11-13 | Q-019 (revised): there is no standalone cleanup project. Reform or clean the database only when a change actually needs it, and only for client data. Nothing is lost, the step is rehearsed on dev against a masked copy, duplicate investments are reversed with both rows kept, and duplicate accounts are merged only for pairs the maintainer confirms. | Phase D runs only when needed. A production run still needs its own approval after the pre-flight report. |
| DEC-6 | 2026-11-13 | Q-020 (revised): client reviews are wanted, admin-only, but deferred. Fix bugs first. | Deferred at the time; built as E1 after DEC-27. |
| DEC-18 | 2026-11-13 | Clients pay SIPs and investments directly to the company bank account, and the admin records them. Whether the gateway is on or off must not affect how quickly and clearly a client sees their investment in the app. | Recording, receipts, value updates and the client dashboard are the core path. Payments-off copy says recorded investments still appear and gives no payment instructions. |
| DEC-19 | 2026-11-13 | The maintainer delegates: work out what else this kind of app needs, and simplify complex flows so both client and admin have a seamless experience. | Client and admin journey reviews (tally `M9-ux-review`) feed section 6. |
| DEC-8 | 2026-11-13 | Q-022: the dashboards show simple return % as the main figure, plus annualised XIRR as a secondary column. | B5. |
| DEC-7 | 2026-11-13 | Q-023: app-update announcement emails keep going to every active client. | No change. |
| DEC-23 | 2026-11-13 | Stay on Node 22. Production images already run `node:22.23.2`, and CI and the packages pin 22. Upgrading to Node 24 is a separate tested step. | Local checks run in a dedicated container with the official Node 22.20.0 and npm 11.16.0 (`tools/node22-container/run.sh`), so the host keeps a single Node install. The upgrade is task E3 (tally `howto-2`, which replaces `howto-1`). |
| DEC-24 | 2026-11-13 | G12: old pending online payments created before payments were turned off are marked expired once their pay-by time has passed. | Step A10. Applied only to checkouts never sent to the provider; checkouts already sent are left for reconciliation when payments return, because the provider may hold a payment for them (tally `finding-23`). |
| DEC-25 | 2026-11-13 | No bank details or payment methods are added or recorded anywhere. The admin records monthly investments under their own category, and the client is notified "Investment added". | B1 and B8. No "How to invest" card or FAQ, and no copy on how or where to pay. G11 is now only publishing `featureFlags.onlinePayments=false`. |
| DEC-26 | 2026-11-13 | The client is also emailed the amount recorded, saying the investment was added to their app and asking them to check it. | Template `investment_recorded` for earlier and monthly recordings, not corrections, with migration 062. |
| DEC-27 | 2026-11-13 | "Complete all the phases that needs code implementation and leave ones out that needs me." | Phase C (C1 to C5) and Phase E steps E1 and E2 were built, which lifts E1's deferral. Phase D (conditional, with a production step needing approval), E3 (maintainer timing), releases and the G11 publish were left out (section 8, Phases C and E close). |
| DEC-13 | 2026-11-14 | Q-027: no reference number of any kind is assigned to or kept on investments the admin records. | In force. No UTR field, column or migration; tally task E4 is removed. |
| DEC-14 | 2026-11-14 | Q-028: payments get no additions or changes; the maintainer asked only for bug fixes and for payments to be disabled. AutoPay and everything related to the payment gateway are halted until the maintainer says to resume them. | In force. E2 stays as built and dormant; no further payment work, including the E2 leftovers. |
| DEC-16 | 2026-11-14 | The Record action on the admin user page offers a Monthly investment category. Every recording has a history with the date it was recorded, kept as a ledger the admin sees and reflected in the client's app. | Built in B1, B2 and B5. F1 added the recorded date to the admin ledger tab. |
| DEC-15 | 2026-11-14 | Q-029: the admin is notified first, by the launch prompt from 30 days before the date. The options are (1) withdraw the invested amount with returns, (2) reinvest the previous amount as a one-time investment and then start recording the next SIP, (3) increase the SIP's time period. The options never pop up for the client by themselves: the admin either resolves directly after talking to the client, or sends the options to that client, who then gets an email and an in-app notification and can choose in the app. Both the client and the admin can decide. | Options 1 and 2 and the 30-day prompt are built (C3). Option 3 as a SIP extension and sending the options to the client are built in Phase F (DEC-30 to DEC-32). |
| DEC-28 | 2026-11-14 | Question answers are decisions, not tally rules. | In force. Every maintainer decision is a tally decision with the ID shown here (group `admin-improvements`), and each answered tally question cites its ID. Tally rules hold only standing constraints that cite their source: `rule-1` (RULES.md), `rule-14` (payments, from DEC-22 and DEC-14) and `rule-15` (no bank details or reference numbers, from DEC-25 and DEC-13). The earlier rule entries that held decisions are retired, and section 8 keeps their old `rule-N` references as history. Tally `convention-6` says where each kind of record goes. |
| DEC-20 | 2026-11-14 | Phase F go-ahead ("Build with defaults"): build F1 to F3 with the conservative defaults of Q-030 to Q-032. | Built (Phase F close, section 8). |
| DEC-29 | 2026-11-14 | Q-026, erasing a client: erasure is refused until the client's invested amount and current value are both zero. Their emails and phones are erased everywhere, including the contact-change history. A client who never completed email verification cannot hold money, so erasing them deletes every record of them. A client who completed email verification is kept as a record with no contact details, and their email and phone can be used again for a new sign-up or a new admin-created client. | Built in Phase G (section 8). A destructive change under rule 11, recorded with its table map, pre-flight and rollback status in `release_manager/docs/client-erasure.md`. |
| DEC-30 | 2026-11-14 | Q-030: a client's maturity pick goes to the admin as the client's choice; nothing changes in money, the ledger or the SIP until the admin confirms, and confirming runs the same resolution as a direct one. | Built in Phase F. |
| DEC-31 | 2026-11-14 | Q-031: the admin fills in the figures for options 2 and 3 before sending; the client only picks one. | Built in Phase F. |
| DEC-32 | 2026-11-14 | Q-032: an extension's new maturity date is filled in as the old date plus the months added, and the admin can change it. | Built in Phase F. |
| DEC-33 | 2026-11-14 | Phase G go-ahead: build client erasure (DEC-29) now. | Built (Phase G close, section 8). |
| DEC-34 | 2026-11-14 | "ok proceed with the next implementations": after Phases F and G, build what remains that needs no maintainer step, which is the gaps the client and admin experience review still shows on `main` (U-close, under DEC-19) and the carried-forward items such as a statement the APK can keep. | Phase H (tally phase `H`), being built (section 6). |
| DEC-35 | 2026-11-14 | Tally rulebook: adopt tally's template, keep only the process rules `RULES.md` does not cover, tailored to this repository, and retire the rest as covered by `RULES.md` ("Process those rules and then read what we have and then adapt to whats best"). | In force. Tally rules are `rule-16` (`RULES.md` is the rulebook), `rule-17` and `rule-18` (payments off; no bank details or reference numbers) and `rule-48` to `rule-54` (scratch, decide once, record once, read once, check once, review once, three attempts). The other 22 template rules are retired, each citing its `RULES.md` rule; write-tests-first conflicted with rule 10. Records now commit once per tally phase. |
| DEC-36 | 2026-11-14 | Q-036: neither the support nor the finance role gets access to client pages; permissions stay as they are. | Being built in Phase H: client links are hidden for roles the page refuses, and screens that cannot name clients for a role say so without raw ids. |

#### Replaced

| Replaced by | Date | Earlier decision | Replaced with | Reason |
| --- | --- | --- | --- | --- |
| DEC-11 | 2026-11-13 | Q-017: invite links valid for 24 hours | Short links plus easy regeneration | Maintainer revised the same day |
| DEC-12 | 2026-11-13 | Q-025: setting the password through the invite marks the email verified | Email code step stays | Maintainer revised the same day |
| DEC-1 | 2026-11-13 | Q-019: a scheduled reform for duplicates and missing details | Reform only when a change needs it | Maintainer clarified the same day |
| DEC-6 | 2026-11-13 | Q-020: reviews built after Phase B | Reviews deferred | Maintainer: bugs first |
| DEC-25 | 2026-11-13 | Payments-off copy points clients to paying the BeOnEdge team directly; G11 includes a "How to invest" FAQ with the bank details | No payment instructions or bank details anywhere () | Maintainer clarified during Phase B |
| DEC-15 | 2026-11-14 | Maturity option 3, "reinvest it as a SIP", built in C3 as closing the active SIP and starting a new schedule funded from the matured value | Option 3 increases the SIP's time period (`DEC-15`, Phase F) | Maintainer clarified when answering Q-029 |

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
| Maturity schedule | A new `client_maturity_schedules` table per client and fund: maturity date (future allowed), state, chosen resolution, links to the settled maturity and any follow-up SIP schedule, actor and version. A new admin dashboard lists upcoming and due dates. A signed-in admin prompt in `AdminFrame` calls `GET /v1/admin/maturities/due` each launch and can be dismissed only for that launch. The resolutions reuse the existing settlement: withdrawal for "return all money"; for "one-time investment from maturity date plus new SIP", record the matured value as a new one-time investment receipt, then create an admin SIP schedule (exact ledger form fixed with Q-021); for "reinvest as SIP", create an admin SIP schedule funded from the matured value. The existing `settlement` enum is never extended. On 2026-11-14 option 3 became extending the SIP, and the admin can send the options to the client (Phase F). |
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
Phase F  maturity choices        F1 ledger recorded date; F2 SIP extension ─ F3 options sent to the client
Phase G  client erasure          G1 guard ─ G2 verified clients kept without contacts; G3 unverified clients deleted
```

Phases A and B need no migration. C1, C2 and C3 add tables or nullable columns. Each phase can ship on its own, with A first.

### Parallel lanes (tally tracks)

Each lane is a tally track `track/<name>` with its own worktree. Lanes in the same phase run in parallel and land one at a time through the tally queue. The board (milestones `M3-gates` to `M11-phase-g`) is the live view.

| Phase | Lane | Steps | Own files |
| --- | --- | --- | --- |
| A | `a-client-values` | A1, A2 (client values), A5 (growth and AUM dates) | admin client-values feature, growth and AUM routes |
| A | `a-payments-off` | A3 | client order and SIP routes, SIP worker, client failure copy |
| A | `a-admin-core` | A2 (other admin screens), A4, A6 | fund-aum, overview, mandates, applications, refunds, receipts, app-config, emails, admin shell, app-config route and contract |
| A | `a-onboarding` | A7, A5 (IST today) | admin users feature, client auth and email verification, guards, recordContribution, createClientAccount, maturity settlement date, onboarding harness and CI |
| A | `a-identity` | A8, after `a-onboarding` lands | createClientAccount, password credential, oversight routes, environment, migration 061, admin users feature |
| B | `b-receipts`, `b-value-updates`, `b-returns`, `b-email-web`, `b-support`, `b-client-investing` | B1–B2, B3, B4–B5, B6, B7, B8 | Each adds its own contract file, so generated exports are regenerated at landing |
| C | `c-composition`, `c-hardening`, `c-nominee`, `c-sip`, `c-reports`, `c-maturity`, `c-payment-sheet` | composition headroom, hardening, C1, C2 → C3 and C4, C5 | Migrations 063 (C1), 064 (C2), 065 (C3) and 066 (C5 audit index), after A8's 061 and B2's 062 (tally `convention-3`) |
| D | `d-data` | D1 → D2 | Runs only when a feature needs a client-data reform. D2's production run needs separate approval. |
| E | `e-reviews`, `e-autopay`; E3 | E1, E2; E3 when the maintainer chooses | Reviews took 067 |
| F | `f-maturity` | F1, F2, F3 | Migration 068; maturity domain and routes, a new client maturity contract and screen, the admin ledger tab and maturities feature (tally `M10-phase-f`) |
| G | `g-erasure` | G1, G2, G3 | Migration 069; admin identity and users routes, the tombstone paths and the repositories that hold client data (tally `M11-phase-g`) |

Shared-file rules:
- `adminQueries.ts` is at 538 of 800 lines after Phase B. A lane moves the hooks it changes into its feature's own query module instead of growing the file.
- `packages/contracts/src/operations/admin-money.ts` is at 730 lines since B1 moved the recording operations into `admin-client-positions.ts`. Later lanes add new contract files.
- `runtime/composition.ts` is at 793 lines after Phase B. A lane that must register a route adds a composition module, as `adminEmailComposition.ts` and `recordingComposition.ts` do.

Maintainer gates (milestone `M3-gates`):
- G1: plan approval.
- G2: permissions, including the container runtime.
- G3–G6: answers to the open questions.
- G7 and G8: dev and production releases.
- G9: the production pre-flight run.
- G10: the payments re-enable decision.
- G11: publish `featureFlags.onlinePayments=false` now that B8 is on `main`. There is no "How to invest" FAQ, and no bank details or payment instructions appear anywhere (tally `rule-15`, DEC-25).
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

  Other lanes add Open links for recordings, value updates, maturity and SIP notices, neutral recording copy, the 100-row ledger with names in previews, rupee inputs, the collective confirm step, monthly reason codes, and mobile navigation favouring Users and Client values. Receipts, Refunds, Payments and Mandates stay reachable in the admin navigation while payments are off, because receipts settled before the switch-off still need acknowledging and those screens hold existing records.

- **A10.** Stale pending online payments (gate G12): while no payment gateway is configured, the payments worker expires one-time checkouts that were never sent to the provider once their pay-by time plus the configured reconciliation grace has passed. It uses the existing expiry transitions under the payment lock, writes one audit row per payment, deletes nothing and moves no money. Checkouts already sent to the provider are left for reconciliation when payments return.

### Phase B — recording categories, receipts, value updates, returns

- **B1.** "Monthly investment" option and server-side category allow-list. Form wording, section titles and notification text follow the category instead of "before the app". Earlier and monthly recordings notify "Investment added" and email the client the amount (`rule-11`, `rule-12`).
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
  - no "How to invest" card and no copy on how or where to pay (DEC-25)
  - pay and invest buttons hidden when the published `featureFlags.onlinePayments` is false; today's behaviour is kept when the flag is absent
  - a single History list while payments are off
  - a printable statement view on the web

### Phase C — nominee, admin SIP schedule, maturity

- **C1.** Nominee migration, client and admin endpoints, Profile form, user page, audit. Populated-upgrade test for the new nullable columns.
- **C2.** Admin SIP schedule table and link, admin create/edit/close, monthly recording linked to a schedule month, and a client months-paid endpoint and badge.
- **C4.** A monthly payment sheet, after C2:
  - pick a month; one row per client and fund from the SIP schedule, with the expected amount, the amount already recorded and the date (today in IST by default)
  - each row keeps its own idempotency key and shows its own result
  - CSV can be pasted into the sheet
  - no bank reference (UTR) field or migration: the maintainer ruled out any reference number on 2026-11-14 (DEC-25, DEC-13)
- **C5.** Accounting exports and a usable audit log:
  - client balances as of a date, and contributions by month (no bank reference column), built as CSV in the browser from new read endpoints
  - money-command presets with amounts and client links
  - a per-client audit list
- **C3.** Maturity schedule table, admin dashboard, due list, launch prompt, and the three resolutions built from existing settlement plus C2. Test: no resolution moves money or writes ledger rows without an explicit admin action, and each resolution is idempotent.

### Phase D — data (after Q-019)

- **D1.** A dev-only cleanup command that refuses to run against a production `NODE_ENV` or database. It keeps every client and investment record, and removes only what Q-019 names.
- **D2.** A read-only pre-flight report that the maintainer runs on production, and a one-time reform step rehearsed on dev against a masked copy. Registered as a rollback boundary in `release_manager/` with a populated-upgrade test before any production run.

### Phase E — later

- **E1.** Client reviews and comments, after Phase B lands (built on lane `e-reviews`, section 8):
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
- **E2.** Before payments are re-enabled: the AutoPay due-date advance, stalled failed or refunded instalments, and mandate reconcile atomicity (section 2B). Built on lane `e-autopay`; payments stay disabled (section 8). Since 2026-11-14 all payment and AutoPay work is halted until the maintainer resumes it (`DEC-14`).

### Phase F — maturity choices (DEC-15, DEC-20; built, section 8)

Built on one lane, `f-maturity`, with migration 068. Phase C is not released, so its maturity endpoints and enums can still change before release. Released APKs only gain new endpoints and a new notification kind, which they show as a plain notice.

- **F1.** The admin client ledger tab shows when each row was recorded, beside its effective date. `createdAt` is already in the response, so there is no contract change.
- **F2.** Option 3 becomes "Extend the SIP":
  - it adds months to the client's active SIP schedule for that fund through the existing schedule edit, and writes no ledger row and no payout;
  - it resolves the maturity and schedules the next one, by default at the old date plus the months added (DEC-32);
  - migration 068 widens the resolution check with the new value, and the old value stays readable.
- **F3.** The admin sends the options to one client:
  - The Maturities dashboard, the launch prompt and the client page gain "Send options to client" beside "Resolve". The admin fills in the figures for options 2 and 3 (DEC-31).
  - Sending saves the offer and notifies the client in the app (a new kind) and by email (new template `maturity_options`, with fund and maturity date, no amounts, and the web app line when configured). Migration 068 widens the template check.
  - The client app shows the maturity, the current value (invested plus returns) and the three options with their figures. The client picks one with a held Idempotency-Key.
  - The pick goes to the admin, who confirms it, and confirming runs the same resolution as a direct one (DEC-30). The admin can still resolve directly at any time, which closes the offer.
  - If the client never picks, nothing happens automatically.
  - Nothing about a maturity shows to the client until the admin sends the options.
- Tests where failure is expensive: no money, ledger or SIP change before the admin confirms; a client cannot read or answer another client's offer; a replayed pick or confirm applies once; and the 068 populated-upgrade test.
- A client on an older APK gets the email and a plain notification, and can choose only after updating or in the web app.

### Phase G — client erasure (DEC-29, DEC-33; built, section 8 and `release_manager/docs/client-erasure.md`)

This deletes and overwrites existing rows, so it is a destructive change under rule 11. The maintainer decided it on 2026-11-14 (DEC-29). Before release, the lane records here:
- every table that holds a client's data, and what erasure does to each one;
- the read-only pre-flight query the maintainer can run first;
- whether its migration is a rollback boundary.

It touches no other client.

- **G1. Guard.** Erasure is refused unless all of these hold:
  - the client's invested amount and current value are zero in every fund;
  - no order, payment, withdrawal or refund is pending;
  - no SIP schedule, maturity or maturity offer is open.

  The refusal names what is blocking, and nothing is changed.
- **G2. Verified client** (completed email verification): the account and money history are kept as a record.
  - Their name, every email and phone, including every contact-change history row, and the nominee are overwritten with the existing tombstone values.
  - So are any copies kept for sign-in events, email deliveries (recipient address and sealed payload), sign-up applications and audit details.
  - Sessions and links are revoked.
  - The email and phone are then free for a new sign-up or a new admin-created client.
- **G3. Client who never completed email verification:** every row of the client is deleted in one transaction:
  - the account, contacts and contact history;
  - invites and links, verification codes, sessions and notifications;
  - email deliveries, and audit rows about the client.

  One audit row of the erasure itself stays, with the admin, the time and no personal data. Such a client cannot invest from the app, but the admin can record investments for any client. So if any ledger, order or payment row exists, erasure falls back to G2 and says so, and never deletes money records.
- Tables whose triggers refuse deletes (append-only records) gain an erase-only path in a new migration (the next free number), used by this command and nothing else.
- Tests:
  - the guard refuses while any money is held;
  - G3 deletes exactly one client's rows and no one else's, and refuses when money rows exist;
  - G2 leaves no email or phone readable anywhere and frees them for reuse;
  - the operation is idempotent and audited;
  - the migration's populated-upgrade test.

### Phase H — experience gaps and carried items (DEC-34; tally phase `H`)

On 2026-11-14, U-close checked the client and admin findings of section 2F (tally `finding-19`, `finding-20`) against `main` at `5def38f`. The items below are what is still open. Items that touch payment, AutoPay or gateway screens are parked under DEC-14 (see the end of this section). Four lanes run in parallel:

- **H1. Statement the APK can keep** (lane `h-statement`, migration 070):
  - In the APK the app asks the server for a one-time statement link and opens it in the phone's browser with the existing Browser plugin. From there the client can print it, save it as a PDF or share it. No new native plugin is added.
  - The link is short-lived, single-use and bound to the client and period, and only a hash of it is stored.
  - The page is the same statement the web print view shows, rendered by the server, with the market-risk line and the as-of date.
  - The Statements screen gains the risk line and the as-of date.
- **H2. Client fixes** (lane `h-client`):
  - The legal and grievance screens render the published content shape, so the support and grievance contacts show. Login gains a support line for clients who cannot sign in.
  - Failed reads show an error with retry instead of "Fund" or a missing row (fund catalogue, SIP read, email verification row).
  - Holdings in paused or archived funds keep their names and open the client's own holding view.
  - The app-update notice opens the update sheet.
  - The dashboard and portfolio show the admin SIP schedules ("N of M months paid"), so a client with only a schedule is not told they have no SIP plans.
- **H3. Admin access and flow** (lane `h-admin-access`):
  - Client links are hidden for roles the page would refuse (DEC-36).
  - The client values cards are gated by the permissions their routes need, and admin accounts leave the client pickers.
  - The payment sheet joins the navigation, and the client page's SIP schedule rows offer "Record this month", which opens the record form prefilled as a monthly investment with the schedule amount and today's IST date.
  - Overview tiles open filtered lists, the email list links to the client, and the sidebar is grouped by section.
  - The send-email client field shows the chosen client.
- **H4. Admin money screens** (lane `h-admin-money`):
  - The investor record can be linked by client and pages past 100 rows.
  - The collective preview shows an error with retry, not raw ids, when names cannot be read.
  - Maturity dialogs and the client page maturity section show failed reads with retry.
  - The audit presets cover the maturity schedule and offer commands.
  - Money displays keep paise where amounts can carry them, and dates are formatted.
  - The remaining fund and AUM inputs take rupees.
- **Parked under DEC-14** (payments, AutoPay and the gateway stay untouched until the maintainer resumes them; tally `finding-27`):
  - endless polling of old in-progress payments;
  - no client cancel for pending payments;
  - AutoPay plan copy and the retry wording;
  - the payments-off flag failing open on a failed config read;
  - the SIP instalment notice that says to pay in the app;
  - a failed AutoPay read showing manual pause, resume and cancel, which the backend does not check either;
  - `lumpSumCount` still counting recorded payments in the API.

## 7. Plan changes and approval gate

- Approval of this plan, of a phase, or of a step is the maintainer's. A proposal or default here is not approval.
- Phase D and any rewrite of existing rows need a separate explicit approval under rule 11, even after this plan is approved.
- Releasing the new screens needs a new client and admin APK export by the maintainer. Older APKs keep working and see plain notifications.
- Work runs on tally tracks with their own worktrees and lands on `main` through the tally landing queue. Records are committed once per phase.

## 8. Progress and handoff

Each step records here what changed, the exact verification (commands and counts), corrected beliefs, remaining risks, and what is unverified. Commits are referenced only after they exist.

### Phase A close (2026-11-13)

Seven lanes landed on local `main` through the tally queue, one at a time. Each lane was reviewed by an independent reviewer before landing, and every commit was checked on its own in a clean checkout in the Node 22 container (contracts build, backend check, frontend check). Nothing is pushed, released or deployed.

| Step | Lane | Commits on `main` |
| --- | --- | --- |
| A7, A5 (IST today) | `a-onboarding` | `cd0a522`, `fabeb5e`, `dd7ab92` |
| A1, A2 (client values), A5 (dates) | `a-client-values` | `ba39307`, `9a9d95d` |
| A3 | `a-payments-off` | `9a83b30`, `847c506` |
| A2 (other screens), A4, A6 | `a-admin-core` | `5cc8bcb`, `a43752b`, `dee2b46` |
| A9 | `a-client-polish` | `f1d316b`, `8429d3b` |
| A10 (G12) | `a-expire-stale` | `9621ab1`, `a9b3ee6` |
| A8 | `a-identity` | `92d0e77`, `139ebd5`, `f105a7f`, `cd9b96d`, `8970a3d`, `8f7618e` |

- **Review outcomes that changed the work.**
  - Admin core: the admin navigation no longer hides Receipts, Refunds, Payments and Mandates when payments are off. Hiding them would have stranded receipts that still need acknowledging.
  - Payments-off: the payment screen allows a 5-minute grace after the pay-by time. After that it keeps checking once a minute, so a late settlement still appears.
  - Client polish: a failed mark-read is reported even after the notification has opened its destination.
  - Expire-stale: the payment is locked before the attempt, in the same order as the pay route.
  - Identity: the security review added the correction cap, tombstone masking in the history, and refusal of the reserved contact ranges.
- **Corrected beliefs.**
  - The SIP worker never created orders. Its pass failed on a non-uuid request id (tally `finding-21`, fixed in E2).
  - The local integration run with coverage enabled fails its 80% branch threshold on clean `main` (78.25%). CI runs that suite with coverage disabled, and so did every check here (tally `finding-22`).
- **Sweep on `8f7618e` (TESTED, clean detached worktree, Node 22.20.0 container):**
  - contracts `npm run check` passed 98 tests, with OpenAPI lint valid and 136 operations reachable;
  - backend `npm run check` passed 98 files / 1180 tests;
  - `npm run test:integration -- --coverage.enabled=false` passed 40 files / 422 tests;
  - frontend `npm run check` passed 27 files / 241 tests;
  - `build:client` and `build:admin` passed, including the bundle boot checks.
- **Carried forward.**
  - Provider-dispatched stale payments still read "Awaiting payment" in the client Activity list. That needs a new list endpoint (tally `finding-23`, moved to B8).
  - Approving an application, a refund action and acknowledging a receipt still mint a key per attempt. Server state and version guards stop duplicates.
  - The AutoPay and mandate defects stay in E2, before any payments re-enable.
  - Q-026 is open.
- **Not verified.** No browser or device run of any changed screen, no APK export, no real mail, nothing on a VPS. Releasing needs new client and admin APK exports by the maintainer (G7, G8). Migration 061 is additive, and the previous release runs against it.

### A8 identity follow-up (lane `a-identity`, commits `92d0e77`, `139ebd5`, `cd9b96d` and the security-review follow-ups after them)

- **Contact correction.** `POST /v1/admin/clients/{userId}/contact-correction` (`clients.create` and `clients.password_links.send`) corrects the email and/or phone of an active client account that holds no role and has not set a password, at the account version the admin read. A new email bumps `email_revision`, retires every outstanding password link and verification code, and queues a fresh invite to the corrected address only; the mail guard cancels mail still bound to the old revision. Nothing is sent to the old address. A phone-only correction sends nothing and keeps the link. Clashes return `STATE_CONFLICT` with per-field messages identical to create-client. Once a password is set the route refuses, and the client's own contact change applies.
- **Release.** `POST /v1/admin/users/{userId}/contact-release` (`users.close`) works only on a closed account without roles, once. It rewrites only the live `email_normalized` and `phone_e164` to unique placeholders (`released+<id>@released.invalid`, `+999` plus an 11-digit sequence number), which satisfy `users_live_pii_valid` and keep `users_email_uk`/`users_phone_uk` intact, so every previous-release lookup by email or phone still finds at most one account and finds the new account after re-creation. The account stays closed and keeps its name, ledger, orders, payments, audit and delivery rows. The previous release shows the placeholders for that account.
- **History.** `GET /v1/admin/users/{userId}/contact-history` (`users.read`) lists corrections and the release with the originals and actor. For a tombstoned account every contact in it is masked with the directory's tombstone values. Audit metadata holds masked email and phone endings only.
- **Security review follow-ups.** A client's contacts can be corrected at most 3 times in 24 hours (counted from `user_contact_history` under the user lock); a fourth attempt answers `RATE_LIMITED` with a retry time. The `+999` phone range and the `released.invalid` email domain are refused with field errors on correction and create-client, and the phone normaliser refuses `+999` for the client's own phone change too. A release also retires leftover email verification codes and pending email-change requests.
- **Invite regeneration.** The existing `POST /v1/admin/clients/{userId}/password-link` already retires older links and works after expiry or a cancelled email. The user page now labels it "Send a new invite link" for clients without a password and explains why the current invite cannot be used. The cooldown now counts only links bound to the current email revision. Invite lifetime and the email code step are unchanged.
- **Migration 061** (`061_user_contact_history.sql`, renumbered from 064 by the coordinator so production applies migrations in order with no gap) adds a sequence and the append-only `user_contact_history` table (update, delete and truncate refused by triggers). It touches no existing row, and the previous release (v0.15.x) runs against it unchanged. It is not a destructive boundary. Tests: `userContactHistoryMigration` (populated upgrade plus previous-release lookups after a release), `adminClientContacts` (14 cases), and `releaseUpgrade` now expects 061.
- **Verification (TESTED, Node 22 container, on `a9b3ee6` with the review follow-ups):** contracts check 98 tests; backend check 98 files / 1180 tests; integration 40 files / 422 tests with coverage disabled as in CI; frontend check 27 files / 241 tests plus `build:admin` (`build:client` last ran before the follow-ups, which do not touch client code). Negative controls: removing the password-set refusal or the revision-scoped cooldown failed 3 integration tests; removing the correction cap, the tombstone masking or the `+999` refusal failed 3 more.
- **Not verified:** no browser run of the new user-page sections, no real mail, nothing on a VPS. Closed administrator accounts cannot release their contacts; the directory search does not match previous contacts. Each later migration must add itself to the `releaseUpgrade` expectation.

### B3 value updates and the monthly sheet (lane `b-value-updates`, commits `7a5f683`, `fcc4314`)

- **Notices.** Individual and collective growth keep kind `client_value_updated`, the same title and amount-free body, and the `/portfolio` deep link that every released APK opens. The payload gains `entryId` (the growth entry). A zero-change client still gets no entry and no notice. New builds open the value-updates screen from `entryId` through `notificationLink` in `resolveDestination.ts`, a per-kind map that b-receipts shares for `client_contribution_recorded`.
- **`GET /v1/client/value-updates`** (client scope, bearer or client web cookie; contract `packages/contracts/src/operations/value-updates.ts`). Pages the signed-in client's growth entries that were not reversed, newest first: entry id, fund id and name (current published version, else slug), effective date, signed change and value after. Value after is the running sum of the position's unreversed entries in entry order (`created_at`, `id`), so a reversed update leaves no gap. It is the position's value right after that update, not the current value: a later contribution or update makes the portfolio higher or lower than the newest row, and the screen labels it "Value after this update". The cursor is bound to the user and carries the microsecond `created_at`, so rows within one millisecond are neither skipped nor repeated (the class of `finding-24`; the older keyset lists are not changed here).
- **`GET /v1/admin/client-growth/funds/{fundId}/positions`** (`client_values.read`, same contract file). One row per position with an unreversed contribution, sorted by name: user id, full name, account state, invested, current value and gain, all paise strings; 404 for an unknown fund. Unpaged, like the investor positions read.
- **Sheet** (`/client-values/monthly`, needs `client_values.read` and `client_growth.write`). The admin picks a fund and types each client's gain since investment in rupees. Closed, suspended and invited clients stay on the sheet, as in the existing collective preview, with a state badge on their row. The change is new gain minus current gain in integer paise; text with more than two decimals or any other format is refused rather than rounded, blank and unchanged rows are skipped, and zero-value or below-zero rows are refused before sending. It previews through the existing collective explicit-deltas preview, refuses a preview whose numbers differ from the sheet, and commits once with one held Idempotency-Key and reason code `monthly`. That commit already validates every row and writes the batch in one transaction, so no per-client loop was needed. Unknown outcomes stay unknown, with Check again on the same key. At most 500 changes per batch.
- **Client screen** `/portfolio/value-updates`, linked from Portfolio, with the money footnote.
- **Compatibility.** No existing response key or enum changed; only notification payload gained a key, which released APKs accept. No migration, no new permission.
- **Verification (TESTED, Node 22 container).** On `7a5f683`: contracts check 98 tests, OpenAPI valid, 138 operations reachable; backend check 98 files / 1180 tests; integration 41 files / 427 tests with coverage disabled; frontend check 27 files / 241 tests. On `fcc4314`: frontend check 28 files / 246 tests, and `build:client` and `build:admin` with both boot checks. New tests: `valueUpdates.integration.test.ts` (5: exact gains from typed rupees including a negative change, one bad row writes nothing, same-key replay commits once and a fresh key is refused on the stale basis, permission on the positions read, client scoping and paging) and `valueUpdateSheet.test.ts` (5: paise arithmetic from rupee text). Negative controls: dropping the user scope, the permission check or `entryId` failed 3 integration tests; making the sheet ignore the current gain failed 2 sheet tests.
- **Not verified.** No browser or device run of either screen, no notification tapped on a device, no APK export, nothing on a VPS.

### Phase B close (2026-11-13)

Six lanes landed on local `main` through the tally queue, one at a time, each after an independent review and its own checks in the Node 22 container. Lanes that shared files were rebased onto the lane landed before them, and the generated OpenAPI and frontend operations were regenerated with the scripts at each rebase. Nothing is pushed, released or deployed.

| Step | Lane | Commits on `main` |
| --- | --- | --- |
| B6 | `b-email-web` | `883b127`, `6f1f86d` |
| B8 | `b-client-investing` | `7b60293`, `e714a8d`, `239a98c`, `b05bd51`, `17ff266`, `a7e6630`, `417e479` |
| B7 | `b-support` | `ecf140c`, `8bf1c64`, `4999848` |
| B3 and its sheet | `b-value-updates` | `22a9b4d`, `56cffb1`, `3d44a7f`, `77a88fa` |
| B4, B5 and the client page and daily overview | `b-returns` | `7203235`, `ba88063`, `e332863` |
| B1, B2 and the investment email | `b-receipts` | `e81eb02`, `e8826b7`, `d9d26b2` |

The B3 entry above was written before landing and names the lane's pre-rebase commits `7a5f683` and `fcc4314`; on `main` they are `22a9b4d` and `56cffb1`.

- **Maintainer decisions during the phase.**
  - No bank details, payment methods or payment instructions anywhere (tally `rule-11`). B8 built a "How to invest" card and removed it before commit. Payments-off copy no longer tells clients to pay the team directly. G11 is now only publishing `featureFlags.onlinePayments=false`.
  - Earlier and monthly recordings notify the client "Investment added" and also email the amount, fund and date with a request to check the app (tally `rule-12`). Corrections read "Investment record corrected" and send no email.
- **B1, B2 (`b-receipts`).**
  - Recordings accept exactly `recorded_offline_investment`, `recorded_offline_monthly_investment` and `recorded_offline_correction`. Released admin builds only ever sent the first and the last, so they keep working.
  - The category is derived when read, and any other stored reason code reads as an earlier investment, which is how every recording showed before. No backfill and no response type narrowed.
  - The recording, ledger and reversal operations moved from `admin-money.ts` into `admin-client-positions.ts`. The generated OpenAPI for existing operations differs only in the narrowed request `reasonCode`.
  - `GET /v1/client/receipts` and `GET /v1/client/receipts/{entryId}` are scoped to the signed-in client; another client's entry answers 404. `categoryLabel` is a server-rendered string, so a later category does not break an older APK. `reversedAt` keeps a reversed recording from reading as live money. `sipMonth` is always null until C2.
  - The `client_contribution_recorded` notice keeps its kind and the `/portfolio` link that released APKs open. Its title follows the category ("Investment added", or "Investment record corrected" for a correction) and names the fund but no amount. Its payload gains `entryId`, `orderId` and `category`, and new builds open the receipt through the same `notificationLink` map that B3 uses.
  - Email template `investment_recorded` is queued in the recording transaction for active, untombstoned clients only, deduplicated per ledger entry, with names and amount sealed. Its send guard cancels on an email change, a closed or tombstoned account, or a reversed recording.
  - Migration 062 only widens `email_deliveries_template_check` with `investment_recorded`. `releaseUpgrade` expects 061 and 062.
  - The client-position and receipt routes register through `runtime/recordingComposition.ts`, which keeps `composition.ts` at 793 lines.
- **B3 (`b-value-updates`).** See the B3 entry above. The review follow-up `77a88fa` labels each row "Value after this update" and shows the client state on the monthly sheet.
- **B4, B5 (`b-returns`).**
  - Endpoints: per-client portfolio summary, the paged returns summary with sort and totals, last value update per fund, invites not accepted, and the per-client ledger page.
  - Simple return % is the main figure. XIRR is secondary, solved by bisection, and null with no outflow, under 30 days of history, or no root. A contribution is an outflow on its effective date, a withdrawal an inflow, a reversal cancels its original, growth is not a flow, and the current value is an inflow on today's IST date.
  - XIRR is solved only for the page shown and the totals (`e332863`); the output is the same, which a one-row-at-a-time paging test asserts.
  - The user page is the client hub (invite status and new link, summary, actions, tabs for ledger, maturity, emails and sign-ins). The overview shows daily tiles for invites not accepted, failed emails and the last value update per fund.
- **B6 (`b-email-web`).** Optional `CLIENT_WEB_APP_URL`, a bare https origin; anything else refuses boot. When set, the approval, invite and app-download emails add a line pointing iPhone and computer users to the web app. It is rendered at send time from configuration, never from the queued payload. The web reset-password screen offers the Android app only when the server returned a download link.
- **B7 (`b-support`).** Admin inbox, ticket detail, idempotent and audited responses that notify the client (kind `support_request_updated`), and a per-client ticket list. No migration. Both lists page on raw `created_at` with a microsecond cursor. Coordinator decision: reopening a closed ticket stays allowed, and every reply must change the status or the note.
- **B8 (`b-client-investing`).** Pay and invest actions hide only when the published `featureFlags.onlinePayments` is exactly `false`; absent, loading or failed config keeps today's behaviour. While off, Activity shows one History list plus every unsettled online payment, which closes `finding-23` with no contract change. Printable statement at `/statements/print`, web only.
- **Compatibility.** No existing response key or enum value changed. New notification kinds and payload keys are accepted by released APKs, which show them as plain notices. `AdminEmailTemplateKey` is a request filter; delivery responses keep `templateKey` as a string. Migration 062 is additive and the previous release runs against it.
- **Release notes for the maintainer.**
  - Add `CLIENT_WEB_APP_URL` to each VPS stack `.env` by hand (a deploy never overwrites `.env`). It is optional; without it the emails simply omit the web app line.
  - A previous-release email worker permanently fails any `investment_recorded` mail it picks up (tally `finding-26`). A normal deploy recreates the API and workers together, so the window is seconds. After a rollback to v0.15.x, unsent investment emails are failed, not retried; the in-app notification is unaffected and the admin email tools can resend.
  - Publish `featureFlags.onlinePayments=false` (G11) to switch the client app to the payments-off layout.
  - New client and admin APK exports are needed for the new screens (G7, G8).
- **Sweep on `d9d26b2` (TESTED, clean detached worktree, Node 22.20.0 container):**
  - contracts `npm run check` passed 98 tests, with OpenAPI lint valid and 149 operations reachable;
  - backend `npm run check` passed 100 files / 1198 tests;
  - `npm run test:integration -- --coverage.enabled=false` passed 44 files / 452 tests;
  - frontend `npm run check` passed 30 files / 260 tests;
  - `build:client` and `build:admin` passed, including the bundle boot checks.
- **Carried forward.**
  - `finding-24`: older keyset lists (the fund receipt queue first) may repeat or skip a row at page boundaries because their cursor holds milliseconds. Value updates and support already use microsecond cursors.
  - `finding-25`: the shared paged query's load-all walk keeps re-requesting after a failed page.
  - The open-tickets tile is built but not yet on the overview, and the client page has no support tab yet. The client notifications screen has no category label for support replies.
  - The APK has no print dialog; a statement PDF endpoint is proposed, not built.
  - Phase C migrations are 063 (C1), 064 (C2) and 065 (C3) (tally `convention-2`).
  - Q-026 is open.
- **Not verified.** No browser or device run of any new screen, no notification tapped on a device, no real mail rendered or sent, no APK export, nothing on a VPS.

### C1 nominee (lane `c-nominee`, commits `01c6418`, `40067f1` and the two review follow-ups after them)

- **Migration 063** (`063_user_nominee.sql`) adds nullable `users.nominee_name` and `users.nominee_relation`, and `nominee_version integer NOT NULL DEFAULT 0` (a constant default, so the table is not rewritten). Every database check is deterministic and needs no collation or locale:
  - each text has 2 to 120 characters, is stored trimmed, and both are set or both null;
  - no C0 or C1 control characters;
  - no format, line separator or paragraph separator characters (`\p{Cf}`, `\p{Zl}`, `\p{Zp}`: zero-width space, direction marks and overrides, U+2028/2029, BOM), listed as explicit Unicode 15.1 code points;
  - the exceptions are ZWJ and ZWNJ (U+200D, U+200C). Malayalam, Sinhala and Devanagari names use them, and `full_name` accepts them, so they are allowed inside a text but refused as its first or last character.
- **Letter rule in the app only.** "Contains at least one letter or number" (`\p{L}` or `\p{N}`) is enforced by the contract and the routes, not by the database. PostgreSQL has no Unicode property classes. A `[[:alnum:]]` check depends on the database's collation, and the ICU collation `und-x-icu` exists only if the cluster was initialised with ICU, which cannot be checked from here. A migration that fails at deploy would block the release, so the database is the backstop for everything except this rule.
- Every existing row gets nulls and version 0 and is otherwise untouched, so the previous release (v0.15.x) runs against it unchanged. It is additive and not a destructive boundary. `releaseUpgrade` expects 063.
- **Tombstone.** Nothing in the code writes `users.pii_tombstoned_at` (as `finding-8` and `finding-13` record). So 063 also adds a `BEFORE INSERT OR UPDATE` trigger that clears both nominee fields on any tombstoned row, whoever writes it. The admin write refuses a closed or tombstoned account.
- **Endpoints** (contract `packages/contracts/src/operations/nominee.ts`):
  - `GET` and `POST /v1/client/profile/nominee` are scoped to the signed-in client, with bearer or client web cookie.
  - The client POST needs `currentPassword`. It uses the same password re-check and limiter as the phone and email changes: 5 attempts per user per 15 minutes, counted before the password is checked. A wrong password answers `INVALID_CREDENTIALS`. It is checked before the "unchanged" no-op, writes nothing and, like a contact change, writes no audit row.
  - The client POST has no idempotency key and no version, like the other profile edits.
  - `GET /v1/admin/users/{userId}/nominee` needs `users.read`. It answers `RESOURCE_NOT_FOUND` for an account that holds roles, matching the write.
  - `POST /v1/admin/users/{userId}/nominee` needs `clients.create`, an Idempotency-Key and the nominee `expectedVersion` it read. It works only for client accounts without roles that are not closed. `seedCatalog.ts` has no `clients.update` or `users.update`; contact correction also uses `clients.create`, so it stays.
  - Responses carry `version`, which is `nominee_version` and exists only on these endpoints. The response texts use the same constrained scalar as the request.
  - In the contract the body is a union: name and relation, or both null. The routes accept exactly the same bodies and report a half nominee as a field error. Error lists include `CSRF_INVALID` on the client GET (the cookie origin check) and `RESOURCE_NOT_FOUND` on the client POST.
- **Version.** A nominee write bumps only `nominee_version` and leaves `users.version` alone, so a nominee edit never makes the admin's next contact correction, suspension or closure conflict.
- **Audit.** Every change writes `user.nominee_changed` (actor user or admin, entity version = nominee version). Its metadata holds `change`, `nameChanged`, `relationChanged` and only the first letter of the previous and current names. Neither the full name nor the relation is stored. Phase H lane `h-hygiene` changed this for new rows: their entity version is `users.version`, as on every other `user` audit row, and the nominee version is in `metadata.nomineeVersion`. Rows written before keep the nominee version as their entity version and are not rewritten.
- **Compatibility.** No existing response key or enum changed; the profile and admin user detail keys, and `users.version`, are asserted unchanged after client and admin nominee edits.
- **Screens.** A Nominee section on Profile asks for the current password in the same way as the contact-change forms. The client hub user page has a Nominee section too. A failed read shows the shared error state with retry. The admin form holds one key per submit and stays locked on an unknown outcome, with Check again on the same key or a reload. Since Phase H lane `h-hygiene`, the client's password goes into the mutation sealed and is cleared when the request is sent, as for every client mutation that sends a password or code (`frontend_stack_ts/src/api/sealedMutation.ts`).
- **Tests.**
  - `userNomineeMigration` (3): the populated upgrade, with previous-release reads and writes through `userRepository` and `adminOversightRepository` (both unchanged since v0.15.4); the database checks; the tombstone trigger. The database checks refuse every `\p{Cf}`, `\p{Zl}` and `\p{Zp}` code point Node knows other than the two joiners, in either field. They also refuse a joiner as the first or last character, and accept a Devanagari name and a Malayalam name with an inner ZWJ.
  - `nominee.integration` (8): own-nominee scoping and audit; wrong password refused before the no-op, then rate limited, nothing written; unauthenticated refusal; `users.version` and the existing responses unchanged; admin permissions with the staff 404; idempotency and stale or non-client refusals; field errors, including zero-width, BOM, direction override, line separator, leading ZWJ, trailing ZWNJ and letterless text; tombstone. The admin path saves and reads back a Malayalam name containing ZWJ.
  - The A8 `userContactHistoryMigration` test now compares its snapshot after applying 061 alone, because later migrations may add columns.
- **Negative controls.**
  - Dropping the user filter from the nominee update failed the own-nominee test.
  - Dropping the tombstone trigger failed both tombstone tests.
  - Ignoring the password verdict failed the wrong-password test.
  - Bumping `users.version` again on a nominee write failed 3 tests.
  - Letting the route accept a joiner as the first or last character failed the field-error test, because the database then refuses with a server error.
  - Refusing joiners everywhere again failed the admin test that saves the Malayalam name.
- **Verification (TESTED, Node 22.20.0 container, rebased on `5722bc0`, after c-reports).**
  - contracts `npm run check` passed 98 tests, with OpenAPI valid and 157 operations reachable;
  - backend `npm run check` passed 100 files / 1198 tests;
  - `npm run test:integration -- --coverage.enabled=false` passed 50 files / 484 tests;
  - frontend `npm run check` passed 32 files / 303 tests;
  - `build:client` and `build:admin` passed with the boot checks;
  - `composition.ts` is at 626 lines;
  - `releaseUpgrade` expects 061, 062, 063 and 066.
- **Open for the maintainer.** None for this lane.
- **Not verified.** No browser or device run of either section, no APK export, nothing on a VPS.

### E1 client reviews (lane `e-reviews`, commits `ac35dde`, `4de32df`)

- **Migration 067** (`067_client_reviews.sql`) adds only the `client_reviews` table: rating 1 to 5, optional comment, state `new`, `read` or `hidden` (labelled "Set aside" in the console), moderation note, moderator, moderation time, version, and a generated `review_month`, the IST calendar month of `created_at` (a review at 23:59:59 IST on the last day and one at midnight fall in different months). The comment and the note are 1 to 1,000 characters, stored trimmed, with no C0 or C1 control character other than a line feed, none of the explicit format, line and paragraph separator code points listed for the nominee in 063, none of the blank-looking characters U+034F, U+115F, U+1160, U+2800, U+3164 and U+FFA0, and no ZWJ or ZWNJ as the first or last character. Emoji variation selectors (U+FE00 to U+FE0F) stay allowed. The contract and routes also require at least one letter, number, punctuation mark or symbol, so a text cannot look blank; PostgreSQL has no Unicode classes, so that rule is not in the database. 067 is ASCII. No existing row is touched, so the previous release (v0.15.x) runs against it unchanged. It is not a destructive boundary. `releaseUpgrade` expects 061, 062, 063, 064, 066 and 067.
- **Repeat rule (lane choice).** One review per client per IST calendar month, enforced by a unique index on `(user_id, review_month)` and by the insert (`on conflict do nothing`), which answers `STATE_CONFLICT`. Because a second review in the same month is impossible, a client whose send had an unknown outcome can check and resend without creating a duplicate. Reviews cannot be edited.
- **Tombstone (lane choice).** Support requests keep their text for a tombstoned account and only mask the name, but nothing writes `users.pii_tombstoned_at` yet, so 067 follows the nominee trigger approach. Setting the tombstone clears every comment and moderation note of that account, bumping the review version, because an admin note may quote the client. A comment or note written later for a tombstoned account is stored as null. Admin reads show `Tombstoned` for the name and no comment or note. Ratings and states are kept.
- **Endpoints** (contract `packages/contracts/src/operations/client-reviews.ts`):
  - `GET /v1/client/reviews` and `POST /v1/client/reviews`, scoped to the signed-in client (bearer, or client web cookie with CSRF on the POST). The POST is limited to 5 requests per client per 10 minutes, in process. The list returns `canSubmit` and `nextSubmissionOn`. Moderation state and notes are never sent to the client.
  - `GET /v1/admin/reviews` (newest first, `state` and `rating` filters, microsecond keyset cursor), `GET /v1/admin/reviews/{reviewId}` and `GET /v1/admin/users/{userId}/reviews` need `support.read`. `POST /v1/admin/reviews/{reviewId}/moderation` needs `support.write`, an Idempotency-Key and `expectedVersion`, refuses a change that repeats the current state and note, and writes audit `client_review.moderated` (metadata `noteChanged` only). The client's submission writes `client_review.submitted` with the rating and whether there is a comment, never the text. No notification is sent either way.
- **Screens.** Profile > Reviews for clients; Reviews in the console's Support group, a review page with the moderation form, and a Reviews tab on the client hub. After an unknown send outcome, Check my reviews reports success only when the newest review is new since the send and has the same rating and comment; any other review this month is reported as an existing review. `composition.ts` is at 636 lines.
- **Verification (TESTED, Node 22 container, on the lane tip before this entry, rebased on `3cd86c1`):** contracts check 98 tests with OpenAPI valid and 169 operations reachable; backend check 100 files / 1198 tests; integration with coverage disabled 54 files / 503 tests; frontend check 32 files / 303 tests; `build:client` and `build:admin` with the boot checks. New tests: `clientReviews.integration` (7: scoping and the monthly rule including a race; text and rating rules in the API and the database, including the blank-looking characters, the visible-character rule, inner joiners and an emoji with a variation selector, plus the rate limit; paging across microsecond neighbours; moderation replay and stale version; permissions; tombstone clearing comments and notes; the IST month boundary) and `clientReviewsMigration.integration` (2: populated upgrade, previous-release user writes including a tombstone). Controls run and reverted, each failing its test: dropping the client scope, the monthly index, the tombstone trigger, the trigger's note clearing, the version guard, the write permission or the visible-character rule; removing U+3164 from the SQL list; computing the month in UTC.
- **Open for the maintainer.** The repeat rule, the tombstone handling and the reuse of `support.read`/`support.write` are lane choices.
- **Not verified.** No browser or device run, no APK export, nothing on a VPS. The rate limit is per process, like the other in-process limiters.

### Phases C and E close (2026-11-14)

On 2026-11-13 the maintainer asked to "complete all the phases that needs code implementation and leave ones out that needs me". So Phase C (C1 to C5) and Phase E steps E1 and E2 were built, together with a composition prep lane and a hardening lane. Left out because they need the maintainer:
- Phase D, which runs only when a feature needs a client-data reform; its production step needs its own approval and pre-flight run.
- E3 (Node 24), whose timing the maintainer decides.
- Releases, publishing `featureFlags.onlinePayments=false` (G11), and the statement PDF endpoint for the APK.

Every lane landed on local `main` through the tally queue, one at a time, each after an independent review whose findings were fixed before landing, and its own checks in the Node 22 container. Nothing is pushed, released or deployed.

| Step | Lane | Commits on `main` |
| --- | --- | --- |
| Composition headroom | `c-composition` | `bb573f0` |
| `finding-24`, `finding-25`, Phase B follow-ups | `c-hardening` | `ed9d60a`, `3e81053`, `71097de`, `35b8353` |
| E2 | `e-autopay` | `c68f31f`, `d28fc3b`, `c197eaa`, `89e596e`, `6e8b320`, `8da4ddb` |
| C5 | `c-reports` | `f0df84a`, `2768b9b`, `9f66354`, `5722bc0` |
| C1 | `c-nominee` | `01c6418`, `40067f1`, `1634797`, `fcf160b`, `a6e14a4` |
| C2 | `c-sip` | `2050360`, `ce3389f`, `3cd86c1` |
| E1 | `e-reviews` | `ac35dde`, `4de32df`, `869c7e5` |
| C4 | `c-payment-sheet` | `edbbaad`, `c53e178`, `03891a3` |
| C3 | `c-maturity` | `b887f54`, `d767ec6`, `ae82558` |

- **Migrations** (tally `convention-3`): 063 nominee, 064 admin SIP schedules, 065 maturity schedules, 066 audit index, 067 client reviews. Each only adds tables, nullable or defaulted columns, triggers or an index. The previous release runs against all of them, and each has a populated-upgrade test. 066 is a plain `CREATE INDEX` (migrations run in a transaction), so it blocks writes to `audit_events` while it builds.
- **Composition (`c-composition`).** The admin route registrations moved unchanged into `runtime/adminComposition.ts`. `composition.ts` went from 793 to 620 lines and is 636 at close.
- **Hardening (`c-hardening`).**
  - About 20 admin and client keyset lists now carry a microsecond cursor. The fund receipt queue had returned the same row 50 times in a one-row walk.
  - Old millisecond cursors from released APKs are still accepted, and the previous release reads the new ones.
  - `usePagedQuery`'s load-all walk stops on a failed page.
  - The open-tickets tile is on the overview, the client page has a Support tab, and support replies are labelled "Support".
- **E2 (`e-autopay`).** Payments and AutoPay stay disabled; these fixes matter only if the maintainer re-enables them.
  - Worker request ids are uuids, and a mid-month SIP gets one order per month.
  - AutoPay advances `next_due_date` once the period's order has an outcome.
  - A failed, refunded or cancelled instalment, or a missed debit window, moves the plan on without re-collecting that month. Its rows are kept, and a skipped month writes an audit row and a warning.
  - The term ends on the planned end month.
  - Each SIP schedule step re-locks its plan and advances only from the expected due date.
  - Admin mandate reconcile commits state, audit and idempotency receipt together.
- **C5 (`c-reports`).**
  - CSV exports built in the browser: balances as of an IST date, and contributions by month (amount before reversal, with a Reversed column, and no bank reference). Cells are guarded against spreadsheet formulas.
  - The audit log gains money presets, a date range and client links, and the client page gains a per-client activity log, served by the 066 index.
- **C2 (`c-sip`).**
  - Admin-tracked SIP schedules: monthly amount, fund, start month and months.
  - A monthly recording can link to a schedule month, once per month, and reversing the recording releases the month.
  - The client sees "N of M months paid", and the receipt shows the month.
- **C4 (`c-payment-sheet`).**
  - A month's sheet of active schedules across funds is served by `GET /v1/admin/recording-sheet`.
  - Rows start unticked. Each ticked row records with its own held Idempotency-Key and exact body in sessionStorage, at most two at a time.
  - CSV paste fills rows and lists unmatched lines. The sheet renders only once every page has loaded.
  - The optional bank reference field and its migration were not built (question row 16).
- **C3 (`c-maturity`).**
  - Admin maturity dates per client and fund, a Maturities dashboard, a client-hub section, and a launch prompt listing maturities due within 30 days (including overdue ones), dismissed per launch only.
  - The three resolutions run only on or after the maturity date, each in one transaction:
    - return all money uses the existing withdrawal settlement, and the amount must equal the current value;
    - a one-time investment plus a new SIP uses the existing reinvestment, guarded by the principal and value the admin saw, then replaces the SIP schedule;
    - reinvest as a SIP writes no ledger row and replaces the SIP schedule.
  - The settlement enum is unchanged.
- **C1 and E1** have their own entries above.
- **Review outcomes that changed the work.**
  - E2: re-locking each SIP step, and auditing skipped periods.
  - Nominee: a current-password check on the client's change, rejection of hidden characters with inner ZWJ/ZWNJ allowed for Indic names, a nominee version separate from the user version, and no ICU collation in 063, because a missing collation would fail the deploy.
  - Reports: the 066 index with an indexable union query, and a formula guard for values behind leading whitespace.
  - SIP: a paged per-fund list, and a two-admin race test.
  - Reviews: moderation notes cleared on tombstone, refusal of more invisible characters, and an exact arrival check.
  - Payment sheet: the full-walk gate, the missing tests, and screen-reader announcements.
  - Maturity: the expected-figures guard on option 2, the start month no earlier than the current month, the closing SIP shown before confirming, and a rollback test.
- **Lane defaults for the maintainer to review.**
  - SIP schedules: one active schedule per client and fund, at most 600 months, months linked in any order, and the recorded amount may differ from the schedule amount.
  - Nominee: the client's change needs the current password (5 attempts per 15 minutes, shared with contact changes), and admin edits use `clients.create`.
  - Reviews: one review per client per IST month with no editing, comments and notes cleared on tombstone, and `support.read`/`support.write` for admin access.
  - Payment sheet: a client reference is the client's email or id.
  - Exports include online payments in contributions.
  - Maturity, AutoPay and the bank reference are questions Q-027 to Q-029.
- **Release notes for the maintainer.**
  - Migrations 063 to 067 apply in order. The previous release runs against them, and 066 briefly blocks audit writes while it builds.
  - The millisecond-cursor fallback can be removed in the release after this one, at least 24 hours after it is deployed.
  - Payments and AutoPay stay disabled, so E2 changes nothing until they are re-enabled.
  - New client and admin APK exports are needed for the new screens (G7, G8).
  - The Phase B notes still apply: add `CLIENT_WEB_APP_URL` to each stack `.env`, `finding-26` (an old email worker drops investment mail), and publish the payments flag (G11).
- **Sweep on `ae82558` (TESTED, clean detached worktree, Node 22.20.0 container):**
  - contracts `npm run check` passed 98 tests, with OpenAPI lint valid and 177 operations reachable;
  - backend `npm run check` passed 100 files / 1198 tests;
  - `npm run test:integration -- --coverage.enabled=false` passed 57 files / 519 tests;
  - frontend `npm run check` passed 34 files / 316 tests;
  - `build:client` and `build:admin` passed, including the bundle boot checks.
- **Carried forward.**
  - E2 leftovers:
    - a long-paused mandate catches up one period per pass and may miss the current window;
    - an unpaid month on a manual plan still blocks that plan;
    - a client may retry checkout on a failed instalment after the plan has moved on.
  - Smaller items:
    - nominee audit rows record `nominee_version` as their entity version;
    - the client nominee mutation keeps the password in the in-memory mutation cache until garbage collection;
    - the 066 query plan was measured on 60,000 rows, not production volume;
    - the APK statement PDF is still a proposal.
  - Q-026 and Q-027 to Q-029 are open.
- **Not verified.** No browser or device run of any new screen, no real mail, no APK export, nothing on a VPS.

### Phase F close (2026-11-14)

Phase F (DEC-15, DEC-20, DEC-30 to DEC-32) was built on lane `f-maturity`. It landed on local `main` through the tally queue after an independent review whose findings were fixed before landing. Nothing is pushed, released or deployed.

| Step | Commits on `main` |
| --- | --- |
| F2, F3 backend and migration 068 | `24400e6` |
| Contracts, generated files, F1 and the admin screens | `c051442` |
| Client screen | `e134227` |
| Review fixes | `8745482` |

- **Migration 068** only adds:
  - the resolution checks are dropped and re-added with `sip_extension`, and `sip_reinvestment` stays allowed;
  - a new append-only `client_maturity_offers` table: one open offer per maturity, offered figures that never change, closed rows frozen, no delete or truncate;
  - the email template check is widened with `maturity_options`.

  The previous release runs against it, and it has a populated-upgrade test. As with `finding-26`, a previous-release email worker would permanently fail any queued `maturity_options` mail after a rollback; the in-app notice is unaffected and the admin can send the options again.
- **F1.** The admin ledger tab has a Recorded column beside Effective.
- **F2.** Option 3 is "Extend the SIP":
  - It adds months to the active admin SIP schedule through the existing edit, with its version check and 600-month cap, and writes no ledger row.
  - It resolves the maturity and schedules the next one in the same transaction, by default at the old date plus the months added and editable (DEC-32).
  - It is refused without an active schedule and for a closed or erased client.
  - The resolve response gains `nextScheduleId`.
- **F3.** The admin sends the options to one client from the dashboard, the launch prompt or the client page, and fills in the figures (DEC-31).
  - The client gets the notification `maturity_options_sent`, whose payload holds the offer, maturity and fund ids and no link, so released apps show a plain notice. The client also gets the email `maturity_options`: fund and maturity date, no amounts, plus the web app line when configured. Its send guard cancels on a closed offer, a closed or erased account, or a changed email.
  - The client sees the current value and the three options with their figures, and picks one with a held Idempotency-Key.
  - The admin confirms the pick, which runs the same resolution as a direct one with the offered figures and the existing guards (DEC-30). Nothing changes money, the ledger or a SIP before that.
  - A send carries the version of the open offer the admin saw, so a stale send is refused instead of silently replacing a client's pick.
- **Review outcome** (independent review: land after fixes, no critical or high finding):
  - option 3 was not checking the client's account state;
  - a concurrent send could replace a client's pick;
  - guard and refusal tests were missing.

  All three are fixed in `8745482`. Each new guard was removed once to show its test fails.
- **Lane defaults for the maintainer to review:**
  - option 3 may be left out of an offer;
  - changing or cancelling a maturity date closes an open offer;
  - options go only to an active client who has not been erased;
  - options may be sent before the date, but are confirmed or resolved only on or after it;
  - withdrawing an offer does not notify the client;
  - if an offered SIP start month has passed by the time the admin confirms, the admin sends fresh options.
- **Landing run (TESTED, tally landing ticket 313b4027, Node 22 container):** each of the four commits passed the contracts build, backend `npm run check` (100 files / 1198 tests) and frontend `npm run check` (34 files / 316 tests, generated client unchanged, bundle boot check) after rebasing onto `main`. The integration suite and the two app builds ran on the lane, and run again in the sweep after Phase G lands.
- **Lane run on 332d5ec (TESTED):**
  - contracts 98 tests, 183 operations reachable;
  - backend 100 files / 1198 tests;
  - integration 59 files / 531 tests;
  - frontend 34 files / 316 tests;
  - `build:client` and `build:admin` passed.
- **Not verified.** No browser or device run, no notification tapped, no real mail, no APK export, nothing on a VPS.

### Phase G close (2026-11-14)

Phase G (DEC-29, DEC-33) was built on lane `g-erasure` and landed on local `main` through the tally queue. It passed three independent reviews: a general one, a PostgreSQL one, and a check that each fix closed its finding. Their findings were fixed before landing. Nothing is pushed, released or deployed, and no client has been erased anywhere.

| Step | Commits on `main` |
| --- | --- |
| G1 to G3 backend, migration 069, tests | `261d5e3` |
| Contracts, generated files, erase screen | `e780686` |
| Table map and pre-flight (`release_manager/docs/client-erasure.md`) | `79f9d14` |
| First review round | `450448a`, `2a93f84`, `6d247f2` |
| Verification round | `1a68f66`, `e29ff37` |

The table map, the pre-flight query and the cost notes are in [client-erasure.md](../release_manager/docs/client-erasure.md). The rule 11 record for this destructive change:

- **What it touches.** Only the one client being erased, in one transaction:
  - their account, contacts and contact history;
  - their credentials, sessions, links and codes;
  - their mail, including Phase F `maturity_options`, and its provider events, outbox events and payloads;
  - their notifications, tickets and reviews;
  - the applications linked to them, or matched by one of their own emails that no one else holds;
  - their own receipts, and the audit rows about them.

  Money rows are never deleted. Another user's rows are byte-identical before and after, which the tests check for both paths.
- **Command.**
  - `GET/POST /v1/admin/clients/{userId}/erase(-check)`, permission `users.close` (superadmin), held Idempotency-Key, typed `ERASE`, and `expectedPath` so a changed outcome is refused.
  - The screen is on the client page.
  - Exactly one `client.erased` audit row is written, with no personal data.
- **Guard (G1).** Erasure is refused, naming every reason and changing nothing, when:
  - the account is a staff account;
  - a legal hold sits on any of the client's records;
  - any fund still holds principal or value;
  - an order, payment, payment attempt, webhook, refund or payout is open, or a payout has failed (still owed);
  - a maturity is unsettled or scheduled, a maturity offer is open, or an admin SIP schedule or a SIP plan is active;
  - mail is mid-send.
- **Kept as a record (G2)**, for a client who verified their email or has any money row:
  - the account is closed and named "Tombstoned";
  - every email, phone and name is overwritten everywhere listed in the map, including the contact history, through 069;
  - the password is cleared, and sessions, links and queued mail are revoked or cancelled.

  The old contacts can be used for a new client. Contact text inside the client's own ledger, payout and maturity notes is replaced, while amounts, dates, ids and financial references stay unchanged (DEC-29, "erased everywhere").
- **Deleted (G3)**, for a client who never verified and has no money row: every row is deleted, children first, apart from the erasure audit row and any receipts that name the id.
- **Pre-flight.** A read-only SQL block counts, for one client id, every blocker and every row each path would touch. It is built on the same sets as the command. It was run on a throwaway database, not on production.
- **Migration 069.**
  - It replaces the body of the 061 contact-history trigger function. The one new exception is scoped by the transaction-local setting `boe.erasing_user_id` to that user's rows and the exact placeholders.
  - It adds three plain indexes: `email_provider_events(email_delivery_id)`, `outbox_events(aggregate_id)`, and `auth_login_events(email_normalized) WHERE user_id IS NULL`. Each one blocks writes to its table while it builds.
  - **It is not a rollback boundary:** the previous release never sets the setting and ignores the indexes. An erasure itself can never be undone, by any rollback.
- **After erasure.** Recording, monthly recordings, SIP schedules, maturity dates, ledger reversals, value updates and contact release all refuse an erased client.
- **What the reviews changed:**
  - holds on any of the client's records now block;
  - earlier applications match by email only, and their mail, consents and audit rows are erased too;
  - a failed payout blocks;
  - receipts belonging to other users are never rewritten;
  - the audit lookups use indexes, and 069 adds three more;
  - names in the client's own free text are replaced;
  - the pre-flight matches the code;
  - a coverage test fails on any new table or column that could hold client data;
  - frontend tests cover the held key and the typed gate;
  - phone matching respects digit boundaries, and financial references are left alone;
  - the mail lock is taken in the worker's order;
  - the password is cleared;
  - erased clients are refused by every recording path.

  Twenty negative controls each failed their test when their guard was removed.
- **Lane defaults for the maintainer to review:**
  - IP addresses and user agents on sessions and audit rows, and the consent IP hash, are kept, because DEC-29 names contact details;
  - email suppressions are kept, since they protect the mailbox;
  - phone endings in audit metadata are kept;
  - in JSON, a name is replaced only where it is the whole value;
  - an `invited` account that is kept as a record stays `invited`, since closing an account needs an activation time.
- **Landing run (TESTED, tally ticket c6d434f4):** all eight commits passed the contracts build, backend `npm run check` and frontend `npm run check` on `main`.
- **Sweep on `e29ff37` (TESTED, clean detached worktree, Node 22.20.0 container), covering Phases F and G together:** contracts `npm run check` passed 98 tests, with 185 operations reachable; backend `npm run check` passed 101 files / 1204 tests; `npm run test:integration -- --coverage.enabled=false` passed 65 files / 557 tests; frontend `npm run check` passed 35 files / 320 tests, with the generated client unchanged at 185 operations; `build:client` (including the Android dist check) and `build:admin` passed with their bundle boot checks. This also completes the sweep deferred from the Phase F close.
- **Not verified.** No browser or device run of the erase or maturity screens, no real mail, no APK export, nothing on a VPS, and the pre-flight has not been run on production.
