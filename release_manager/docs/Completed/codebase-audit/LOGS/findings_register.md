# Findings register

Every finding, classified, with its disposition. `F-0xx` for defects, `D-0xx` for dead code,
`C-0xx` for configuration, `P-0xx` for persistence, `T-0xx` for tooling and documentation.

Classes: **DEAD** · **STALE** · **DUPLICATE** · **BROKEN/STUCK** · **LATENT** · **UNCERTAIN**.

## Lifecycle defects

| # | Finding | Class | Disposition |
| - | ------- | ----- | ----------- |
| F-001 | Collection attempts had one exit, requiring `GatewayNotFoundError`; `reconcileCollections` swallowed every error and `MandateCollectionConfig` had no grace parameter. Order, payment and attempt wedged permanently, polled every 60 s forever | BROKEN/STUCK | **FIXED** — time-based expiry edge + `collectionsExpired`; 2 new tests |
| F-002 | `lockDueRefunds` had no due predicate, lease or cap; a stuck refund produced a provider call every 5 s indefinitely. `last_status_checked_at` written, never read | BROKEN/STUCK | **FIXED** — `checkedBefore` predicate + `markStatusChecked` on 3 non-progress paths; 3 new tests |
| F-003 | The mandate reconciliation summary was discarded; its grace and claim limit were hardcoded while the payment path read config | BROKEN/STUCK | **FIXED** — summary returned as `mandateReconciliation`, both values from `serverConfig` |
| F-004 | A SIP whose installment order ends non-`accepted` pins `next_due_date` forever; the plan is re-listed every pass with no progress | BROKEN/STUCK | **REPORTED** — product decision; `/pay` legitimately accepts `payment_failed` |
| F-005 | `refund_operations` has no failure cap; `attempt_count` is incremented and compared to nothing | BROKEN/STUCK | **REPORTED** — auto-failing a refund is a financial decision |
| F-006 | Both relay adapters map not-found from HTTP status alone. D-071's error-code fix and its regression test were deleted with the PhonePe gateway | LATENT | **REPORTED** — relay contract is out of repo; D-057 forbids guessing |
| F-007 | `reconciliation_required` is terminal by omission — nothing re-claims it, and there is no operator tooling in the worker path | UNCERTAIN | **REPORTED** |
| F-008 | Backlog gauges are computed and exported; nothing alerts on them. All four worker healthchecks go green on a stack where no payment is reconciled and no mail is sent | BROKEN/STUCK | **REPORTED** — highest-value observability gap |
| F-009 | `NOTIFY_TRANSITIONS.failed → dispatching` declared and plumbed through two signatures, never exercised | DEAD | **REMOVED** — `failed` is now terminal; test updated |

## Dead code

| # | Finding | Class | Disposition |
| - | ------- | ----- | ----------- |
| D-001 | `db/repositories.ts`: 14 of 15 port interfaces had zero consumers; the concrete repositories declare their own | STALE | **REMOVED** — 507 → 77 lines |
| D-002 | 58 command/input/row types orphaned by D-001 | DEAD | **REMOVED** |
| D-003 | `ApplicationQueueQuery`, `UserWithCredential`, `RevokeSessionsResult` each declared twice | DUPLICATE | **REMOVED** the `db/repositories.ts` copies |
| D-004 | `Role`, `Permission` row aliases — no consumer | DEAD | **REMOVED** |
| D-005 | 9 repository methods with no production caller | DEAD | **REMOVED** |
| D-006 | `createLogEmailSender` — the fail-open email sender its own comment records as retired | DEAD | **REMOVED** with `EmailSendLog` |
| D-007 | `lockByEmailWithCredential` — superseded by the non-locking login lookup; two comments said "used to" | STALE | **REMOVED**, comments rewritten |
| D-008 | 24 frontend exports with zero external references and a single intra-file occurrence | DEAD | **REMOVED** + cascade |
| D-009 | `pushSystemChrome` was the sole writer to `stack` and sole caller of `notify`, and had no caller itself — so `getSystemChrome()` always returned the default and `subscribeToSystemChrome` could never emit | DEAD | **REMOVED** — subsystem collapsed, behaviour identical |
| D-010 | The generator emitted `OPERATIONS`, `OperationId`, `OPERATION_IDS`; nothing imports them | DEAD | **REMOVED** in the generator; output 315 → 207 lines |
| D-011 | Three ad-hoc `Intl.NumberFormat` constructions beside `domain/money.ts` | DUPLICATE | **CONSOLIDATED** onto `formatRupees` |
| D-012 | `AsyncBoundary.isSessionEndingError` duplicated `api/errors.isSessionEnded` verbatim — and was why the latter had no importers | DUPLICATE | **CONSOLIDATED** |
| D-013 | Three declarations of the same four breakpoints | DUPLICATE | **REDUCED to two** — one per language |
| D-014 | 13 unused `--be-*` CSS tokens | DEAD | **REMOVED** |
| D-015 | `@capacitor/local-notifications` — no import, no bridge, no registration | DEAD | **REMOVED** |
| D-016 | `POST_NOTIFICATIONS` permission justified by `updateNotification.js`, a file that does not exist | DEAD | **REMOVED** |
| D-017 | `divider-fade` `@utility` unreferenced after the `DIVIDER` removal | DEAD | **REPORTED** — same-pass double removal not worth the risk |
| D-018 | ~30 over-exported but intra-file-used backend symbols | ACTIVE | **UNTOUCHED** |
| D-019 | `selectPaymentGateway` has one live outcome; every `paymentGateway === null` guard now means "relay unconfigured" | ACTIVE | **REPORTED** |
| D-020 | `GatewayAuthenticationError` is not thrown by either relay adapter, yet `classifyGatewayFailure` branches on it | UNCERTAIN | **REPORTED** |
| D-021 | Three stale `LINK_MAP` edges naming a source that renders no such link | STALE | **CORRECTED** |
| D-022 | `worker:payments:watch` is byte-identical to `worker:payments:dev` | DUPLICATE | **REPORTED** |

## Configuration

| # | Finding | Class | Disposition |
| - | ------- | ----- | ----------- |
| C-001 | Root `.env.example` — no root compose file, nothing reads a root `.env`, keys unused or renamed | STALE | **DELETED** |
| C-002 | `PROVIDER_MODE` in the production stack example — no reader | DEAD | **REMOVED** |
| C-003 | `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET` — pre-rewrite symmetric names; the scheme is ES256 | STALE | **REMOVED** |
| C-004 | `ALLOW_DEV_AUTH`, `MOCK_WEBHOOK_ENABLED` — no implementation. `ALLOW_DEV_AUTH` reads as though a bypass exists | DEAD | **REMOVED** |
| C-005 | `DATABASE_SSL` — `db/config.ts` has no SSL key; TLS is not configurable | DEAD | **REMOVED** from the example and both compose files |
| C-006 | `DATABASE_HOST/PORT/NAME/USER/PASSWORD` in both compose files — `DATABASE_URL` is the only value read | DEAD | **REMOVED** |
| C-007 | `SEED_ADMIN_FIRST_NAME/LAST_NAME/PHONE` documented but the code read `ADMIN_*`; the admin silently seeded as "BeOnEdge Admin" while the sibling `SEED_CLIENT_*` keys worked | BROKEN/STUCK | **FIXED in code** — `SEED_* ?? ADMIN_*` |
| C-008 | `TRUST_PROXY` — the only control over whether login-event IPs are real — appeared in no example | STALE | **DOCUMENTED** |
| C-009 | `DB_STATEMENT_TIMEOUT_MS`, `DB_IDLE_IN_TRANSACTION_TIMEOUT_MS` in no example despite a rationale comment | STALE | **DOCUMENTED** |
| C-010 | `envPassthrough.test.ts` intersected the schema with the example, so a missing key could never fail and an undeclared key was invisible | BROKEN/STUCK | **FIXED** — reverse-direction guard, proven both ways |
| C-011 | `AWS_REGION` / `SNS_TOPIC_ARN` / `SES_CONFIGURATION_SET` absent from both stack examples, so the SES/SNS inbox is unreachable in every deployment | BROKEN/STUCK | **REPORTED** — enabling a never-run path is a maintainer decision |
| C-012 | `PAYMENT_PROVIDER` is `z.literal("phonepe")` — a switch that cannot switch | LATENT | **REPORTED** |
| C-013 | `APK_DOWNLOAD_BASE_URL` is a two-value enum of hard-coded hostnames | UNCERTAIN | **REPORTED** |

## Persistence — nothing changed

| # | Finding | Class | Disposition |
| - | ------- | ----- | ----------- |
| P-001 | `rate_limit_windows` — zero references; rate limiting is in-process and per-process, so limits do not survive a restart | DEAD | **REPORTED** |
| P-002 | `finance_policy_versions` — zero references | DEAD | **REPORTED** |
| P-003 | `legal_holds` — only a type alias, now removed | DEAD | **REPORTED** |
| P-004 | `user_credentials` lockout trio never read or written; `026_login_events.sql` documents the deferral | LATENT | **REPORTED** |
| P-005 | `db/types.ts` under-describes `user_credentials` by one column, and no test compares types to migrations | STALE | **REPORTED** |
| P-006 | `provider_events` `processing` / `dead_lettered` unproducible; lease and backoff columns never written or read | LATENT | **REPORTED** (D-050) |
| P-007 | The `provider_events` claim index on `(available_at, created_at, id)` serves no query — the one item with an ongoing write cost, and not mentioned in D-050's note | DEAD | **REPORTED** — first candidate if anything is retired |
| P-008 | `auth_sessions.expired` has no writer; expiry is enforced by timestamp | DEAD | **REPORTED** |
| P-009 | `applications.withdrawn` read in four places, no writer | STALE | **REPORTED** |
| P-010 | `orders.cancelled` — no writer found | UNCERTAIN | **REPORTED** |
| P-011 | **No `deleteFrom` and no pruning anywhere.** Six tables grow without bound; `expires_at`, `erased_at`, `pii_tombstoned_at` and the lease columns encode a lifecycle nothing advances | BROKEN/STUCK | **REPORTED** — a retention worker is a feature |
| P-012 | `idempotency_records.expires_at` honoured on read, never swept; `IDEMPOTENCY_TTL_MS` sizes a value nothing enforces | STALE | **REPORTED** |
| P-013 | `PROVIDER_EVENT_TTL_MS` is the only TTL written into a row, and it is written by the route that is unmounted in both stacks | STALE | **REPORTED** |
| P-014 | `erased_at` / `pii_tombstoned_at` have no writer — a compliance gap, not just dead code | UNCERTAIN | **REPORTED** |
| P-015 | `provider_events.signature_valid` written only as `true` | DEAD | **REPORTED** |
| P-016 | `mandate_collection_attempts.retry_strategy` — no reader found | UNCERTAIN | **REPORTED** |
| P-017 | `OutboxState` `processing` / `dead_lettered` — same shape as the confirmed-dead `provider_events` states; `outboxRepository.ts` not read in full | UNCERTAIN | **REPORTED** — highest-value remaining check |

## Tooling, deployment, documentation

| # | Finding | Class | Disposition |
| - | ------- | ----- | ----------- |
| T-001 | nginx `boe_auth` matched 2 of 4 login endpoints; `/v1/auth/client/web/login` and `/v1/auth/admin/native/login` got 20 r/s instead of 5 r/m — and the nginx zone is the only real brute-force control, since the DB rate-limit table is dead | BROKEN/STUCK | **FIXED** — needs `nginx -t` + reload on the VPS |
| T-002 | `x-worker-health` declared and aliased by no service; the `touch`/`rm -f` were writes nothing read. Kept alive by a test asserting the text, not the use | STALE | **REMOVED**, test rewritten |
| T-003 | `test_e2e/faq-debug.mjs` — one-off probe, hardcoded credentials, zero references | DEAD | **DELETED** |
| T-004 | `test_e2e/frontend-ts-shots.mjs` — 20 hand-maintained paths against `frontend-ts-audit.mjs`'s 45 manifest-derived routes | STALE | **DELETED** |
| T-005 | `repo_sync_notice()` — 26 lines, zero callers; `status.sh` renders the globals inline | DEAD | **REMOVED** |
| T-006 | Commented `/ws/` blocks in three configs plus the `$connection_upgrade` map that served them; no websocket code exists | DEAD | **REMOVED** |
| T-007 | 15 `BOE_APP/` rules in `release_manager/.gitignore` for a directory that does not exist | STALE | **REMOVED** |
| T-008 | `frontend_stack_ts/.kotlin` untracked **and** unignored | STALE | **FIXED** |
| T-009 | `apk_manifest_debuggable` — a release-safety check that is unit-tested and never runs | LATENT | **KEPT** — wire it or retire it deliberately |
| T-010 | `DEPLOY.md` documented a non-existent directory and flag set, **inverted the DB-restore default**, omitted all four workers, and contradicted the nginx install mapping | STALE | **REWRITTEN** |
| T-011 | `CLAUDE.md` described the pre-TypeScript backend: `server.js`, `shared/`, `db/store.js`, `authz:*`, CSS Modules | STALE | **CORRECTED** |
| T-012 | `WORKFLOW.md` cited `BOE_APP/current-version.json` and `authz:*` CI guards | STALE | **CORRECTED** |
| T-013 | `PRODUCT.md` scopes the out-of-repo marketing site but sits unqualified at this repo's root | STALE | **SCOPE BLOCK ADDED** |
| T-014 | Six uncontracted v1 mutations (3 admin user lifecycle, 3 client SIP lifecycle) | UNCERTAIN | **REPORTED** |
| T-015 | Five backend error codes with no frontend handler; `CURSOR_INVALID` has a user-visible consequence | UNCERTAIN | **REPORTED** |
| T-016 | `kimi-api-key.txt` — 73 bytes, untracked, gitignored, never committed, still on disk | LATENT | **REPORTED** — rotate and remove |
| T-017 | `routeIntegrity.test.ts` measures declared reachability, not rendered links; D-062 is unenforced. A static guard was built and reverted as unsound | UNCERTAIN | **REPORTED** — only the runtime crawl can close it |
| T-018 | `release_manager/tests/*.test.sh` and `verify.sh` are in no CI job | STALE | **REPORTED** (documented in `WORKFLOW.md`) |
| T-019 | `.github/workflows/ci.yml` already points at `frontend_stack_ts`; the blueprint's claim that it is hardcoded to the deleted tree is itself stale | — | **REPORTED** |

## Claims investigated and disproved

Recorded so they are not re-opened.

| Claim | Verdict |
| ----- | ------- |
| Four admin `overview` link-map edges are stale | **FALSE** — `OverviewScreen` renders them dynamically from `ADMIN_ROUTES` |
| The generated client has four duplicate alias keys | **FALSE** — the registry keyed by `operationId`, the exports by `exportName` |
| `BREAKPOINTS` is dead | **FALSE** — used by `FundListScreen` via `useBreakpoint`/`isCompact` |
| `abandonUndispatchedSetup` has no call site | **FALSE** — `clientAutoPaySipRoutes.ts:481` |
| nginx restricts `/metrics` to loopback | **FALSE** (my own error in a draft) — the guard is `isPrivateRequest` in the app |
| Duplicate percent/date formatters, pagination hooks, overlay/skeleton/form-field/error-state systems, session stores | **FALSE** — each is single-source |
| `fund_stock_disclosures` is dead | **FALSE** — reachable only through raw SQL; a type-only audit would have condemned it |
