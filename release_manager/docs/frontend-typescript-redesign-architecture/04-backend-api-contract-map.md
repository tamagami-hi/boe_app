# 04 — Backend API Contract Map

The authoritative integration reference. Build the new frontend against this document, not
against legacy frontend call sites.

Legend: **Envelope** = `reply.sendData(...)` wrapped in `{ok,data,error,meta}`. **Raw** = plain
`reply.send`, not enveloped. **Idem** = a valid `Idempotency-Key` header is required.
**CSRF** applies to the web/cookie transport only.

## Auth channels

| Channel | How | Used by |
|---|---|---|
`public` | no credential | health, app config, app update, public content
`public-secret` | `x-signup-key` shared secret, constant-time compare, **fails closed when unconfigured** | `POST /newuser` only
`native-bearer` | `Authorization: Bearer <ES256 JWT>` → `authenticateNativeRequest` (`domain/auth/nativeAuth.ts`) | **every** `/v1/client/*` route
`admin-web` | `resolveAdminPrincipal` (`domain/admin/adminAccess.ts`) → cookie or bearer, then live `findActiveRolesAndPermissions`, then `requireAnyPermission` | every `/v1/admin/*` route
`provider-webhook` | PhonePe SHA-256 shared secret or SNS certificate provenance | `/v1/provider-events/*`

`resolveAdminPrincipal` picks the transport: if there is no access cookie and there is a
bearer header it uses the native path, otherwise the web path. **The cookie wins when both
are present.** `requireCsrf` is `false` on admin GETs and `true` on every admin mutation,
consistently across all admin route files.

## Conditional registration — read this before assuming an endpoint exists

`src/runtime/composition.ts` gates three groups. When the condition is false the routes are
**absent, not disabled**, so the client gets `404 RESOURCE_NOT_FOUND`.

| Condition | Absent when false |
|---|---|
| `providerEvents.awsRegion !== null && topicArn !== null` | `POST /v1/provider-events/aws-sns` |
| `payments.phonepe !== null` | `/v1/provider-events/phonepe/payment`, `/refund` |
| `payments.phonepe !== null && recurringPaymentGateway !== null` | `/v1/provider-events/phonepe/subscription`, **all `/v1/admin/mandates*`, all `/v1/admin/mandate-collections/*`** |

`/v1/client/sips/autopay*` is registered **unconditionally** but fails at runtime when
`payments.autoPay.enabled` is false or the recurring gateway is null — it throws
`MOBILE_CHECKOUT_DISABLED` (a misleading code name, retained). Similarly
`POST /v1/client/orders/:orderId/pay` is always registered but throws
`DEPENDENCY_UNAVAILABLE` when `paymentGateway` is null.

**Frontend requirement:** the mandate admin screens must present a 404 as "PhonePe is not
configured in this environment", not as "not found".

## Ops and health

| Method | Path | Module | Auth | Response |
|---|---|---|---|---|
| GET | `/health/live` | `runtime/application.ts` inline | public | **Raw** `{status:"ok"}`, DB-independent |
| GET | `/health/ready` | `runtime/health.ts` | public | **Raw** `{status:"ready"\|"degraded", checks:{database,emailTransport,emailEventIngress}}`, 200 or 503 |
| GET | `/v1/health` | `runtime/health.ts` | public | Envelope `{status:"ok"}` — this is the reachability probe the splash uses |
| GET | `/metrics` | `runtime/health.ts` | IP-scoped inside `runtime/metrics.ts::renderMetrics` | **Raw** Prometheus text. Not a frontend concern. `NEEDS RUNTIME VERIFICATION` that the allowlist behaves behind nginx `trustProxy` |

## Onboarding

| Method | Path | Handler | Auth | Request | Response |
|---|---|---|---|---|---|
| POST | `/newuser` (**unversioned, deliberately**) | `publicOnboardingRoutes.ts::handleNewUser` | `public-secret` | `newUserBodySchema`: `fullName`, `email`, `phone`, `password`, `consent: literal(true)`, optional `idempotencyKey` | Envelope `{accepted, outcome, verificationEmailQueued}`; **202** on create, **200** on replay |

Called server-to-server by the marketing site. The idempotency key is the body's
`idempotencyKey` **or** a derived SHA-256 over
`{emailNormalized, phoneE164, fullName, consents, submissionGeneration}` — password excluded
deliberately, and `submissionGeneration` (from `countTerminalSubmissions`) prevents a rejected
applicant being stuck behind a 24-hour replay. Creates an `applications` row only; no user, no
credential, no session, and no email.

**Not a surface for the new frontend** unless the marketing site is in scope.

## Authentication — web (cookies + CSRF)

All envelope. Module `routes/webAuthRoutes.ts`, commands in `domain/auth/webAuth.ts`.

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| POST | `/v1/auth/web/login` | public | `loginSchema {email, password}` strict | 200, sets access + refresh cookies via `applyAuthCookies` |
| POST | `/v1/auth/web/refresh` | refresh cookie + `x-csrf-token` + `validateWebOrigin` | `refreshSchema {rotationId: uuid}` | 200 with rotated cookies; `reuse_revoked` → cookies expired + `SESSION_INVALID` |
| GET | `/v1/auth/web/csrf` | access **or** refresh cookie + Origin | — | 200 `{csrfToken…}`, `cache-control: no-store` |
| POST | `/v1/auth/web/logout` | `authenticateWebRequest(..., {requireCsrf: true})` | — | 200 `{loggedOut: true}` |

Cookies: `__Host-boe_access` / `__Host-boe_refresh`, or `boe_access` / `boe_refresh` when
`cookieSecure` is false — **the `__Host-` prefix is applied only when `Secure` is actually
set**, because browsers discard it otherwise. Attributes `HttpOnly; Secure(conditional);
SameSite=Lax; Path=/`. Access `Max-Age` 600 s, refresh 30 days.

`issueWebLoginSession` rejects a principal with zero roles as outcome `not_authorized` while
still answering `INVALID_CREDENTIALS`.

`GET /v1/auth/web/csrf` is the reload-recovery path: it identifies the session from the access
cookie if it still verifies, otherwise via `lockByRefreshTokenHash` on the refresh cookie,
re-issues a CSRF token, and returns the principal. It is safe without a prior CSRF token
because `validateWebOrigin` runs first and a cross-origin caller cannot read the JSON.

## Authentication — native (bearer + device)

All envelope. Module `routes/nativeAuthRoutes.ts`, commands in `domain/auth/nativeAuth.ts`.

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| POST | `/v1/auth/native/login` | public | `{email, password, device:{installationId: uuid, name, platform: "android", appVersion: semver}}` | 200 `{user, accessToken, accessTokenExpiresAt, refreshToken, refreshTokenExpiresAt, sessionId}` |
| POST | `/v1/auth/native/refresh` | refresh token in body | `{refreshToken: /^[A-Za-z0-9_-]{43}$/, rotationId: uuid}` | 200 rotated credential; `reuse_revoked` → `SESSION_INVALID` |
| POST | `/v1/auth/native/logout` | native bearer + body refresh token | `{refreshToken}` | 200 `{loggedOut: true}` |

`platform` must be the literal `"android"`. `installationId` is SHA-256 hashed into
`auth_sessions.device_id_hash`. `enforceDeviceLimit` **evicts rather than rejects**: a
same-`installationId` login revokes the prior session (`device_reauthenticated`), then
oldest-first eviction over `deviceLimit.maxDevices` (`device_limit_exceeded`), with
`exemptEmails` for a seeded QA client. The design reason is that a lost phone must not strand
a user.

There is **no client session endpoint**. Native restore works by trusting the cached principal
when an access token and principal are both present, otherwise by rotating the stored refresh
token.

### Refresh rotation — the contract the client must respect

Successors are deterministic:
`rawRefresh = base64url(HMAC-SHA256(refreshKey, "boe-refresh-v1|sid|generation|rotationId"))`,
persisted as unkeyed SHA-256. Three outcomes:

1. **Current token** (`used_at IS NULL AND revoked_at IS NULL`) → rotate, insert generation
   N+1, set `previous_refresh_token_hash` and `previous_refresh_valid_until = now + 30s`,
   record `last_rotation_id`.
2. **Grace replay** — presented hash equals `previous_refresh_token_hash`, within 30 s, **and
   `session.last_rotation_id === input.rotationId`** → the identical successor is re-derived
   and returned with **no write**. This is what makes a client retry idempotent.
3. **Anything else** → `revokeSessionFamily(reason: "refresh_reuse")`, mapped to
   `SESSION_INVALID`. The revocation is returned rather than thrown so that it commits.

Web rotates the CSRF token in lockstep, and a documented gap remains: the mixed pair
(current refresh + previous CSRF) is not recovered.

**Therefore the new frontend must coalesce concurrent refreshes per scope.** Two parallel
rotations of the same token are indistinguishable from theft and will kill the session
family.

## Client — portfolio

Module `routes/clientPortfolioRoutes.ts`. All `native-bearer`, all envelope.

| Method | Path | Handler | Request | Response |
|---|---|---|---|---|
| GET | `/v1/client/eligibility` | `getEligibility` | — | eligibility snapshot (`domain/client/investingEligibility.ts`) |
| GET | `/v1/client/portfolio` | `getPortfolio` | — | derived portfolio (`portfolioLedger.ts` + `portfolioProjection.ts`) |
| GET | `/v1/client/transactions` | `listTransactions` | `transactionsQuerySchema` | `{items: [mapTransaction]}` |
| GET | `/v1/client/orders` | `listOrders` | `historyQuerySchema` (`limit` + `after` cursor) | `{items: [mapOrder]}` + `meta.page` |
| GET | `/v1/client/orders/:orderId` | `getOrder` | `uuidParam` | `{order}` |
| GET | `/v1/client/payments/:paymentId` | `getPayment` | `uuidParam` | `{payment}` |

**Ownership violations return `RESOURCE_NOT_FOUND`, not 403.** `errorCatalog`'s
`INTERNAL_OUTCOME_TO_CODE` maps `WRONG_OWNER → RESOURCE_NOT_FOUND` deliberately: cross-tenant
access must be indistinguishable from absence.

`portfolioProjection` is guarded by `investment-architecture.guard.test.ts` — its source must
not contain `nav` or `units`. There is no NAV/units-per-holding model.

## Client — catalogue

Module `routes/clientCatalogRoutes.ts`. `native-bearer`, envelope, Redis-cached.

| Method | Path | Handler | Cache |
|---|---|---|---|
| GET | `/v1/client/funds` | `listFunds` | **not cached** — `CACHE_KEYS.fundList` exists but is unreferenced |
| GET | `/v1/client/funds/:fundId` | `getFund` | `cache.readOrLoad(CACHE_KEYS.fundDetail(fundId), catalogTtlMs, …)` |

**Staleness warning:** `invalidatePrefix` is never called by any route, so publishing a new
fund version does not evict `funds:detail:*`. It expires on TTL only. The frontend will
observe this.

## Client — orders and payments

Module `routes/clientOrderRoutes.ts`. `native-bearer`, envelope, **Idem required on both**.

| Method | Path | Handler | Request | Response |
|---|---|---|---|---|
| POST | `/v1/client/orders` | `postCreateOrder` | `Idempotency-Key` + `createOrderBodySchema {fundId, amountPaise}` where `amountPaise: z.string().regex(/^[1-9][0-9]*$/u)` | **201** order; replay carries `meta.idempotencyReplay` |
| POST | `/v1/client/orders/:orderId/pay` | `postPay` | `Idempotency-Key` + `payBodySchema {checkoutChannel: z.literal("hosted_redirect")}` | 200 `{orderId, paymentId, provider:"phonepe", status:"payment_in_progress", checkout:{type:"redirect", url} \| null, expiresAt}` |

**This is the post-refactor shape and it is currently uncommitted.** See blocker B1.

`postPay` internals the frontend must account for:

- If the order state is not in `{submitted, payment_pending, payment_failed}` it returns
  `{status: projectOrderStatus(state), terminal: true}` — a terminal state is a normal
  response, not an error.
- An open attempt (`state ∈ {created, provider_pending}`) is **reused**. A channel mismatch
  on reuse is `STATE_CONFLICT`.
- The **dispatch claim** sets `provider_dispatch_started_at` only if
  `checkout_channel = 'hosted_redirect' AND state = 'created' AND provider_dispatch_started_at IS NULL`.
  **If the claim fails, the response is `checkout: null` plus the current expiry** — the
  client must then poll payment status, not request a second checkout URL.
- The provider call happens outside any transaction. On failure the response is
  `DEPENDENCY_UNAVAILABLE` and the attempt stays `created` with a dispatch timestamp; the
  reconciliation worker owns it from that point.
- The returned `checkout.url` has already been validated against
  `config.checkoutAllowedOrigins` (https only, no userinfo, exact origin match). Currently
  `https://mercury.phonepe.com` and `https://mercury-t2.phonepe.com`. **The frontend must
  validate again before navigating.**
- `redirectUrl` sent to PhonePe is `null`. The return target is merchant-dashboard
  configuration, not code. `NEEDS RUNTIME VERIFICATION`.

## Client — SIP plans

Module `routes/clientSipPlanRoutes.ts`. `native-bearer`, envelope. **No `Idempotency-Key` on
the three transitions** — they are treated as naturally idempotent state changes.

| Method | Path | Handler | Request | Response |
|---|---|---|---|---|
| POST | `/v1/client/sips` | `createSip` | `createSipBodySchema {fundId, amountPaise, debitDay, durationMonths}` | **201** `mapSip` |
| GET | `/v1/client/sips` | `listSips` | — | `{items: [mapSip]}` |
| POST | `/v1/client/sips/:sipPlanId/pause` | `pauseSip` | `sipParamsSchema` | 200 `mapSip` |
| POST | `/v1/client/sips/:sipPlanId/resume` | `resumeSip` | ″ | 200 |
| POST | `/v1/client/sips/:sipPlanId/cancel` | `cancelSip` | ″ | 200 |

`debitDay` is constrained to **1–28** by the DB CHECK. `durationMonths` is nullable or
positive. `collection_mode` defaults to `manual_checkout`.

## Client — AutoPay

Module `routes/clientAutoPaySipRoutes.ts`. `native-bearer`, envelope.

| Method | Path | Handler | Request | Response |
|---|---|---|---|---|
| POST | `/v1/client/sips/autopay` | `postAutoPay` | `bodySchema` + `Idempotency-Key` | **201** `{checkout:{type:"phonepe_sdk", token, merchantId, environment}, providerOrderId, expiresAt, status:"mandate_setup_in_progress"}` / 200 replay |
| GET | `/v1/client/sips/autopay/:sipPlanId` | `getAutoPay` | `paramsSchema` | 200 mandate + setup state including `authorizedAt` |
| POST | `/v1/client/sips/autopay/:sipPlanId/cancel` | `postCancel` | params + `Idem` | 200 `{mandateId, status:"cancelled"}` or **202** `{status:"cancel_pending"}` |
| POST | `/v1/client/sips/autopay/:sipPlanId/setup/retry` | `postRetry` | params + `Idem` | 201 new setup checkout |

**This is the blocker.** The checkout payload is a native PhonePe SDK token, not a URL. There
is no browser path — `browserPlatform.start` returns `{status:'unavailable'}`. A retry within
the token TTL replays the decrypted token. The token is AES-GCM encrypted with AAD bound to
`{mandateId, setupAttemptId, merchantSubscriptionId, merchantOrderId, providerOrderId}`
(`domain/payments/mandateSetupToken.ts`).

Frontend amount cap in the legacy client: `amountPaise ≤ 1_500_000` (₹15,000) and
1–360 months. `NEEDS RUNTIME VERIFICATION` whether the backend enforces the same range.

## Client — Email OTP Verification

Module `routes/clientEmailVerificationRoutes.ts`. `native-bearer`, envelope. This is an
**in-app, post-login** step.

| Method | Path | Handler | Request | Response |
|---|---|---|---|---|
| POST | `/v1/client/email-verification/start` | `issueCode` | — | 200 issue/cooldown state |
| POST | `/v1/client/email-verification/resend` | **`issueCode` — the same handler** | — | identical |
| POST | `/v1/client/email-verification/verify` | `postVerify` | `{code: /^[A-Za-z0-9]{6}$/}` | 200 verified |
| GET | `/v1/client/email-verification-status` | `getStatus` | — | 200 `{status, emailVerificationState, method:"email_otp", expiresAt, expired, submittedAt, verifiedAt}` |

`start` and `resend` are registered on the same handler at
`clientEmailVerificationRoutes.ts:126-127` — the cooldown is enforced inside `issueCode`.
**The new frontend should call `/start` only** and treat `/resend` as legacy.

Error mapping the UI must handle distinctly:

| Internal outcome | Wire code | HTTP |
|---|---|---|
| resend inside cooldown | `RATE_LIMITED` + `retryAfterSeconds` | 429 |
| attempt cap reached (5) | `STATE_CONFLICT` | 409 |
| no active verification | `STATE_CONFLICT` | 409 |
| code expired (10 min) | `TOKEN_EXPIRED` | 410 |
| wrong or absent code | `TOKEN_INVALID` | 400 |
| SMTP failure after commit | `DEPENDENCY_UNAVAILABLE` | 503 |

The last one matters: because the mail is sent **after** the transaction commits, a transport
failure leaves a live unsent code with the resend cooldown already started. The UI must say
"we could not send the email — try resend in N seconds", not "verification failed".

## Client — account and support

Module `routes/clientAccountRoutes.ts`. `native-bearer`, envelope.

| Method | Path | Handler | Request | Response |
|---|---|---|---|---|
| POST | `/v1/client/app-version` | `reportAppVersion` | `appVersionSchema {platform, variant, applicationId, versionName, versionCode}` | 200 reconciliation + update decision |
| GET | `/v1/client/notifications` | `listNotifications` | `listQuerySchema {limit}` | `{items}` |
| PATCH | `/v1/client/notifications/:notificationId` | `markNotificationRead` | `uuidParam` + `{read: literal(true)}` | 200 notification |
| GET | `/v1/client/payments` | `listPayments` | `paymentsQuerySchema` (`status=`) | `{items}` |
| GET | `/v1/client/statements` | `listStatements` | — | statements (`domain/client/statements.ts`) |
| GET | `/v1/client/support/faqs` | `listFaqs` | — | `{items}` |
| GET | `/v1/client/support/tickets` | `listTickets` | `listQuerySchema` | `{items}` |
| POST | `/v1/client/support/tickets` | `createTicket` | `createTicketSchema` | **201** ticket |
| GET | `/v1/client/research-context` | `researchContext` | — | `{items: []}` when unpublished |

**There is no bulk mark-all-read endpoint.** The legacy `markAllRead` is a no-op.

**Payments are split across two modules**: the list is here (`clientAccountRepository`), the
detail is in `clientPortfolioRoutes.ts` (`clientPortfolioRepository`). Not duplicate paths,
but split ownership. `NEEDS RUNTIME VERIFICATION` that the two return consistent payment
shapes.

## Public

| Method | Path | Module | Request | Response |
|---|---|---|---|---|
| GET | `/v1/app-config` | `publicAppRoutes.ts` | — | `{version, config, publishedAt}` — **all `null` when unpublished, never 404**. Redis-cached |
| GET | `/v1/app/update` | `publicAppRoutes.ts` | `updateQuerySchema {platform, variant, applicationId?, versionCode?, version?}` strict | **always 200** update decision |
| GET | `/v1/public/disclosures` | `publicContentRoutes.ts` | — | document, 404 if unpublished. Redis-cached |
| GET | `/v1/public/investor-charter` | ″ | — | key `investor-charter` |
| GET | `/v1/public/grievance` | ″ | — | key **`grievance-redressal`** (note the mismatch between path and key) |

### `GET /v1/app/update` — the exact contract

```
{ platform, variant, updateAvailable, mandatory,
  current: { version, versionCode, applicationId },
  latest: null | { version, versionName, versionCode, applicationId,
                   sizeBytes, sha256, url, publishedAt },
  minimumSupportedVersion, maintenance }
```

- `updateAvailable` = a published artifact exists **and** `latest.versionCode > query.versionCode`.
  Ordering is on `versionCode` only, because `versionName` carries a git label in dev builds
  and is not reliably comparable.
- `mandatory` = `compareVersions(baseVersion(query.version), baseVersion(minimumSupportedVersion)) < 0`.
  It is a statement about the **caller**, independent of whether a newer APK exists. An absent
  or unparseable floor is never mandatory, so a config typo cannot lock everyone out.
- Artifacts are filtered by `applicationId`, because dev and prod APKs have different ids and
  certificates and Android refuses a signature mismatch.
- Unauthenticated on purpose: a client too old to authenticate must still learn it has to
  update. The client must call it with raw `fetch`, outside the 401-refresh machinery.
- `latest` comes from the filesystem via `release/releaseFeed.ts`, which **stats the APK
  before advertising it** (the publish is two separate renames, and advertising in that window
  would hand out a 404), rejects a sidecar without `apk`/`versionCode`/`applicationId`/`sha256`,
  rejects `signing !== "release"`, and rejects `/`, `\` or `..` in the filename. Listings are
  cached 30 s. If `APK_RELEASE_ROOT` is unset every answer degrades to "nothing published" —
  an absent feed must never break app startup.
- `version` sent by the client must be `baseVersion(versionName)` — `/^[0-9]+(?:\.[0-9]+)*/`,
  so `"0.7.4-dev.0.gabc123"` → `"0.7.4"`.
- The client must read the running build from the package manager via `AppUpdate.getInfo()`,
  **not** from a bundled constant, because the JS bundle and the APK are versioned by
  different pipelines.
- `actionable` (a client-side concept worth keeping) = `updateAvailable && latest.url && latest.sha256`.
  A manifest without a download URL is not actionable.

## Admin — identity and applications

Module `routes/adminIdentityRoutes.ts`. `admin-web`.

| Method | Path | Handler | CSRF | Request | Response |
|---|---|---|---|---|---|
| GET | `/v1/admin/session` | `getSession` | false | — | `{userId, roles, permissions, …}`; **rejects `roles.length === 0`** with `AUTHORIZATION_DENIED` |
| GET | `/v1/admin/applications` | `listApplications` | false | `applicationsQuerySchema` (`limit ≤ 100`, `after`) | `{items}` + `meta.page` |
| GET | `/v1/admin/applications/:applicationId` | `getApplicationDetail` | false | `uuidParam` + `applicationDetailQuerySchema` | detail |
| POST | `/v1/admin/applications/:applicationId/decision` | `decideApplication` | **true** + **Idem** | **decision in the QUERY STRING**: `?outcome=approved\|rejected`; body must be `{}` (`decisionBodySchema` strict empty) | 200 result or replay |

**The decision endpoint is the single most likely place for a new client to get
`VALIDATION_FAILED`.** The outcome is a query parameter and the body must be empty. This is
unusual and looks like a leftover, but it is the live contract.

On `approved`, `domain/admin/decideApplication.ts` creates the `users` row, copies the
password hash into `user_credentials`, wipes `applications.password_hash`, enqueues an
`account_approved` outbox event with `deduplicationKey = "account_approved:<userId>"`, and
creates the email delivery row.

| Method | Path | Handler | Request |
|---|---|---|---|
| GET | `/v1/admin/email-deliveries` | `listEmailDeliveries` | `emailDeliveriesQuerySchema` (`state`, `templateKey`, `limit`) |

## Admin — fund catalogue

Module `routes/adminCatalogRoutes.ts`. GETs CSRF-false; mutations CSRF-true + **Idem**;
PATCHes require **`If-Match`**.

| Method | Path | Handler |
|---|---|---|
| GET | `/v1/admin/funds` | `listFunds` |
| GET | `/v1/admin/funds/:fundId` | `getFund` |
| POST | `/v1/admin/funds` | `createFund` |
| PATCH | `/v1/admin/funds/:fundId` | `patchFund` — `If-Match` |
| POST | `/v1/admin/funds/:fundId/versions` | `createFundVersion` |
| GET | `/v1/admin/funds/:fundId/stocks` | `listStocks` |
| POST | `/v1/admin/funds/:fundId/stocks` | `addStock` |
| PATCH | `/v1/admin/funds/:fundId/stocks/:stockId` | `patchStock` — `If-Match` |
| DELETE | `/v1/admin/funds/:fundId/stocks/:stockId` | `removeStock` |

`parseIfMatchVersion` requires `If-Match: "<integer>"`. A mismatch surfaces as
`VERSION_CONFLICT → STATE_CONFLICT` (409, retryable). The UI must **re-read and re-present**,
never blind-retry.

## Admin — AUM

Modules `routes/adminAumRoutes.ts` and `routes/adminFundGrowthPreviewRoutes.ts`.
`admin-web`, **rate-limited** (`deps.rateLimiter.hit(principal.userId || request.ip)`,
fixed window from `fundAum.rateLimitWindowMs` / `MaxRequests`), all mutations require **Idem**.

| Method | Path | Handler | Response |
|---|---|---|---|
| POST | `/v1/admin/aum/funds/:fundId/initialize` | `initializeFund` | **201** `{snapshot, growthBatchId}` |
| POST | `/v1/admin/aum/funds/:fundId/growth` | `applyGrowth` | 201 |
| POST | `/v1/admin/aum/snapshots/:snapshotId/corrections` | `correctSnapshot` | 201 |
| GET | `/v1/admin/aum/funds/:fundId/history` | `fundHistory` | CSRF false, `historyQuerySchema` |
| POST | `/v1/admin/aum/growth/collective/preview` | separate module | preview with `basisHash` |
| POST | `/v1/admin/aum/growth/collective` | `collectiveCommit` | commit, requires the preview's `basisHash` |

`adminFundGrowthPreviewRoutes.ts` is a one-route module split off `adminAumRoutes.ts` sharing
the identical `adminAumDeps` object; its own header says the split exists solely to satisfy
the dependency-wall path scanner in `investment-architecture.guard.test.ts`.

**The preview-then-commit protocol is enforced by a guard test.** Both batch-growth
orchestrations must recompute a basis hash under lock, compare it to the caller's, require an
idempotency key, and commit inside one transaction. `basisHash` is 64 hex characters. A
mismatch means the underlying data moved — the UI must **clear the preview and force a
re-preview**, which is exactly what `AumScreen.jsx` does on 409.

## Admin — client growth

Module `routes/adminClientGrowthRoutes.ts`. `admin-web`, CSRF true, **Idem**.

| Method | Path | Handler |
|---|---|---|
| POST | `/v1/admin/client-growth/individual` | `individual` |
| POST | `/v1/admin/client-growth/collective/preview` | `collectivePreview` |
| POST | `/v1/admin/client-growth/collective` | `collectiveCommit` |

Basis-point cap `clientGrowth.maxBasisPoints`. Writes `client_growth_batches` headers over
`client_value_entries` rows of kind `growth_adjustment`. A 409 on individual means the
position changed.

## Admin — oversight

Module `routes/adminOversightRoutes.ts`. `admin-web`.

| Method | Path | Handler | Notes |
|---|---|---|---|
| GET | `/v1/admin/users` | `listUsers` | `status`, `q`, `limit`, `after` |
| GET | `/v1/admin/users/:userId/detail` | `getUserDetail` | |
| GET | `/v1/admin/users/:userId/login-events` | `listLoginEvents` | **no frontend caller today** |
| POST | `/v1/admin/users/:userId/suspend` | `suspendUser` | CSRF true + Idem, `reasonCodeSchema`/`reasonDetailSchema`. **No frontend caller** |
| POST | `/v1/admin/users/:userId/reinstate` | `reinstateUser` | ″ |
| POST | `/v1/admin/users/:userId/close` | `closeUser` | ″ |
| GET | `/v1/admin/audit-logs` | `listAuditEvents` | |

## Admin — fund receipts, refunds, payments

Module `routes/adminFundReceiptRoutes.ts`. `admin-web`.

| Method | Path | Handler | Notes |
|---|---|---|---|
| GET | `/v1/admin/fund-receipts` | `listQueue` | `state=awaiting\|acknowledged` |
| GET | `/v1/admin/fund-receipts/:orderId` | `getDetail` | |
| POST | `/v1/admin/fund-receipts/:orderId/acknowledge` | `acknowledgeFunds` | `{expectedVersion, privateNote?}` + Idem — optimistic concurrency in the body, not `If-Match` |
| GET | `/v1/admin/refunds` | `listRefunds` | |
| POST | `/v1/admin/refunds/:refundId/retry` | `retryRefund` | |
| POST | `/v1/admin/refunds/:refundId/reconcile` | `reconcileRefund` | |
| GET | `/v1/admin/payments` | `listPayments` | |

**Nothing in the codebase creates a refund row.** `refundRepository.create` exists and has no
caller. The retry/reconcile endpoints can only finish a row that no code path produces.

## Admin — mandates (conditionally registered)

Module `routes/adminMandateRoutes.ts`. `admin-web`.

| Method | Path | Handler | Permission |
|---|---|---|---|
| GET | `/v1/admin/mandates` | `listMandates` | `payments.read` |
| GET | `/v1/admin/mandates/:mandateId` | `getMandateDetail` | `payments.read` |
| POST | `/v1/admin/mandates/:mandateId/reconcile` | `reconcileMandate` | `finance.operate` |
| POST | `/v1/admin/mandates/:mandateId/cancel` | `cancelMandate` | `finance.operate` |
| POST | `/v1/admin/mandate-collections/:collectionId/reconcile` | `reconcileCollection` | `finance.operate` |

Body is always `{reason}`. All idempotency-scoped.

## Admin — content and app config

Module `routes/adminContentRoutes.ts`. `admin-web`. Invalidates Redis on write.

| Method | Path | Handler | Notes |
|---|---|---|---|
| GET | `/v1/admin/faqs` | `listFaqs` | |
| POST | `/v1/admin/faqs` | `createFaq` | **legacy frontend sends no `Idempotency-Key` here** |
| PATCH | `/v1/admin/faqs/:faqId` | `patchFaq` | also used for publish/unpublish via `{status}` |
| DELETE | `/v1/admin/faqs/:faqId` | inline → `cache.invalidate([CACHE_KEYS.supportFaqs])` | |
| GET | `/v1/admin/app-config` | `getAppConfig` | |
| PATCH | `/v1/admin/app-config` | inline → `cache.invalidate([CACHE_KEYS.appConfig])` | publishes a new version, retiring the current |

## Provider webhooks

Not a frontend surface. Listed so nobody builds against them. **All non-enveloped.**

| Method | Path | Verification |
|---|---|---|
| POST | `/v1/provider-events/aws-sns` | SNS certificate provenance: outer parse → header cross-check → hardened `SigningCertURL` → topic ARN match → certificate validity → RSA signature → 15-minute freshness. Uniform 401 `SNS_SIGNATURE_INVALID` on any failure. `text/plain` ≤ 256 KiB |
| POST | `/v1/provider-events/phonepe/payment` | raw **Buffer** body parser; `paymentGateway.validateShaCallback(authorization, raw)`; `paymentEventAllowlist`; non-Buffer body → `UNSUPPORTED_MEDIA_TYPE`. ≤ 64 KiB |
| POST | `/v1/provider-events/phonepe/refund` | same, allowlist hardcoded `["pg.refund.completed","pg.refund.failed"]` in `composition.ts` |
| POST | `/v1/provider-events/phonepe/subscription` | raw **string** body parser; `validateShaCallback`; `parseCallback`; merchantId equality; `autoPay.subscriptionEventAllowlist`; flow-type checks |

PhonePe authenticity is a shared-secret SHA-256, not HMAC:
`sha256("<callbackUsername>:<callbackPassword>")`, `Authorization` must be exactly 64 hex
characters, compared with `timingSafeEqual`. The body must parse to an object with top-level
`event` and nested `payload.state`; the legacy `type` field is deliberately ignored.

**No webhook ever trusts its payload.** It is inboxed for deduplication
(`dedup_key = "<event>:<merchantRef>:<providerState>"`, `ON CONFLICT DO NOTHING`) and then the
route re-reads the truth from the gateway.

## Error catalogue — all 24 codes

`src/http/errorCatalog.ts`.

| Code | HTTP | Retryable | Frontend handling |
|---|---|---|---|
| `VALIDATION_FAILED` | 400 | no | show `error.fields` inline; the messages are already user-facing prose |
| `CURSOR_INVALID` | 400 | no | restart pagination from the first page |
| `TOKEN_INVALID` | 400 | no | wrong OTP — clear the input, keep attempts remaining visible |
| `AUTHENTICATION_REQUIRED` | 401 | no | route to login |
| `INVALID_CREDENTIALS` | 401 | no | generic login failure; never disclose which field |
| `SESSION_INVALID` | 401 | no | session family revoked — clear the vault and route to login with `endedReason: 'expired'` |
| `SNS_SIGNATURE_INVALID` | 401 | no | webhook only |
| `PROVIDER_CALLBACK_UNVERIFIED` | 401 | no | webhook only. **Missing from `packages/contracts`** |
| `AUTHORIZATION_DENIED` | 403 | no | admin: render Forbidden |
| `ACCOUNT_NOT_ACTIVE` | 403 | no | render the terminal-account wall |
| `CSRF_INVALID` | 403 | no | recover via `GET /v1/auth/web/csrf`, then retry once |
| `RESOURCE_NOT_FOUND` | 404 | no | **also means "not yours"** and "route not registered in this environment" |
| `ACTIVE_APPLICATION_EXISTS` | 409 | no | onboarding only |
| `STATE_CONFLICT` | 409 | **yes** | re-read and re-present. Used for version conflicts, attempt-channel mismatch, OTP attempt cap, no active verification |
| `IDEMPOTENCY_KEY_REUSED` | 409 | no | the same key with a different body — a client bug; mint a new key |
| `IDEMPOTENCY_IN_PROGRESS` | 409 | **yes** | `Retry-After: 1`; wait and retry the same key |
| `TOKEN_ALREADY_USED` | 409 | no | |
| `TOKEN_EXPIRED` | 410 | no | OTP expired — offer resend |
| `PAYLOAD_TOO_LARGE` | 413 | no | body limit is 65 536 bytes |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | no | |
| `RATE_LIMITED` | 429 | **yes** | honour `retryAfterSeconds`; used by the OTP cooldown and AUM writes |
| `INTERNAL_ERROR` | 500 | **yes** | generic; no detail is ever on the wire |
| `MOBILE_CHECKOUT_DISABLED` | **409** | no | AutoPay disabled in this environment. **Missing from `packages/contracts`** |
| `DEPENDENCY_UNAVAILABLE` | 503 | **yes** | gateway or SMTP down; also `POST /pay` when PhonePe is unconfigured |

`mapInternalOutcome` translates internal vocabulary so it never reaches a client:
`VERSION_CONFLICT → STATE_CONFLICT`, `WRONG_OWNER → RESOURCE_NOT_FOUND`,
`REFRESH_REUSE → SESSION_INVALID`, `ORIGIN_DENIED`/`FETCH_SITE_DENIED → CSRF_INVALID`.

Framework errors are routed through the same renderer: `FST_ERR_CTP_BODY_TOO_LARGE`/413 →
`PAYLOAD_TOO_LARGE`; `FST_ERR_CTP_INVALID_MEDIA_TYPE`/415 → `UNSUPPORTED_MEDIA_TYPE`;
`FST_ERR_VALIDATION*` / `FST_ERR_CTP_EMPTY_JSON_BODY` / 400 → `VALIDATION_FAILED`; anything
else → `INTERNAL_ERROR`, logged as `UNEXPECTED_REQUEST_FAILURE`.

## Pagination

Cursors are opaque `base64url(payload).base64url(HMAC-SHA256)`. Payload is
`{r: route, f: filterHash, v: sortValues[], e: expiryMs}` with a 24-hour TTL.
`computeFilterHash` is a SHA-256 over the sorted filter entries.

`decodeCursor` fails closed with `CURSOR_INVALID` on a bad signature, expiry, **route
mismatch, or filter mismatch**.

**Consequences for the frontend, both mandatory:**

1. Treat the cursor as fully opaque. Never construct, parse or persist it as meaningful.
2. **Restart pagination whenever any filter changes.** A cursor minted under one filter set
   cannot be replayed under another.

`paginate()` over-fetches `limit + 1`, sets `hasMore`, and emits `nextCursor` from the last
kept row's `sortValues` (typically `[createdAt, id]`). `MAX_ADMIN_LIMIT = 100`, default 25.
There is no offset and no total count anywhere — do not build a numbered pager.

## Idempotency

- Header scalar: `/^[A-Za-z0-9._:-]{8,128}$/`.
- Absent or malformed → `VALIDATION_FAILED` with `fields: {"idempotency-key": [...]}`.
- `executeIdempotent` runs inside a caller-owned transaction:
  1. `findCompleted` → byte-compare the stored `request_hash` against `hashRequest(canonical)`.
     Equal ⇒ **replay** the stored status and body with `meta.idempotencyReplay: true`.
     Unequal ⇒ `IDEMPOTENCY_KEY_REUSED`.
  2. `tryAcquireTransactionLock` (a PostgreSQL advisory lock). On failure re-check completion,
     else `IDEMPOTENCY_IN_PROGRESS` with `Retry-After: 1`.
  3. Execute, then `insertCompleted` with `expiresAt = now + idempotencyTtlMs`.
- The request hash is over a **canonicalised** object — sorted keys, `undefined` dropped,
  bigint→string — so key semantics are order-insensitive.
- Admin scope is `{actorScope: "admin:<userId>", method, routeTemplate, key}`, so the same key
  is reusable across routes and actors.

**Frontend key strategy** (the legacy `helpers/idempotencyKeys.js` gets this right and the new
frontend must reproduce it): mint `crypto.randomUUID()`, cache it per logical operation scope,
and **re-mint whenever the serialised body changes**. The same request retried reuses the key
and safely replays; an edited request gets a new key and cannot 409 against the earlier
attempt.

`requireIdempotencyKey` is duplicated four times in the backend — the shared one in
`adminRouteKit.ts:38` plus local re-implementations in `clientOrderRoutes.ts:76`,
`clientAutoPaySipRoutes.ts:76` and `adminIdentityRoutes.ts:129`. Same semantics, four bodies.
`optionalIdempotencyKey` appears unused. Not a frontend concern, but noted for backend
cleanup.

## CORS

`src/http/cors.ts` reflects the origin **only** when it is in `WEB_ORIGIN_ALLOWLIST`
(`serverConfig.web.originAllowlist`, the same list the web-auth Origin check uses). Never
`*`. Always `Vary: Origin`. `Access-Control-Allow-Credentials: true`.

| | Values |
|---|---|
| Allowed request headers | `content-type, authorization, idempotency-key, if-match, x-csrf-token, x-request-id` |
| Exposed response headers | `x-request-id, etag, retry-after` |
| Allowed methods | `GET, POST, PATCH, PUT, DELETE, OPTIONS` — `PUT` is advertised but no route uses it |

Preflights are answered in the `onRequest` hook with 204 and never reach a route. A bare
`OPTIONS` without `Access-Control-Request-Method` falls through to the 404 handler.

**Blocker B5: the new frontend origin must be added to `WEB_ORIGIN_ALLOWLIST`** or every
browser response is discarded and the app looks entirely offline. The APK sends
`Origin: https://localhost` (because `androidScheme: 'https'`), and the host nginx forwards
`Origin $http_origin` specifically so that value survives — so `https://localhost` must also
be allowlisted.

## `packages/contracts` — current state and what to do with it

Location: repository root `packages/contracts` (**not** under `frontend_stack`). ESM-only,
`sideEffects: false`, `private: true`, `files: ["dist"]`. Subpath exports `.`, `./scalars`,
`./envelope`, `./errors`, `./public`, `./native-auth`, `./admin-fund-aum`.

What is good and reusable:

- `src/operations/descriptor.ts` — `defineOperation` with a discriminated
  `OperationSecurityPolicy` (`authChannel`: `public`, `public-token`, `native-activation`,
  `native-login`, `native-refresh`, `native-bearer`, `admin-web`) and
  `MAX_JSON_BODY_BYTES = 65_536`, matching the backend's `boundary.ts`. **This is the right
  shape for a generic typed client**: method, path, request schemas, success status and
  schema, `errorCodes`.
- `src/envelope.ts` — `createSuccessEnvelopeSchema(dataSchema, metadataShape?)` with strict
  objects, rejecting reserved meta keys and prototype-sensitive validation field keys
  (`__proto__`, `prototype`, `constructor`).
- `src/scalars.ts` — a genuinely strong scalar library: `Uuid`, `IsoDateTime` (offset +
  4-digit year, normalised to UTC), `EmailInput`, `MaskedEmail` (canonical `x***@domain` with
  IDNA domain validation), `PhoneInput`, `FullName`, `ReasonCode`, `ReasonDetail`,
  `VersionTag`, `IdempotencyKey`, `Cursor`, **`Paise`** (string, ≤ PG bigint max),
  `Decimal24x8`, `Decimal30x12`, `PasswordInput` (12–128 Unicode scalars, no C0/C1).

Coverage: **15 paths / 19 operations** out of roughly 90 registered endpoints.

Covered: `GET /v1/public/consent-documents`; `POST /v1/auth/native/{login,refresh,logout}`;
`GET,POST /v1/admin/funds`; `GET,PATCH /v1/admin/funds/{fundId}`;
`POST /v1/admin/funds/{fundId}/versions`; `POST /v1/admin/funds/{fundId}/stocks`;
`PATCH,DELETE /v1/admin/funds/{fundId}/stocks/{stockId}`;
`POST /v1/admin/aum/funds/{fundId}/{initialize,growth}`;
`POST /v1/admin/aum/snapshots/{snapshotId}/corrections`;
`GET /v1/admin/aum/funds/{fundId}/history`;
`POST /v1/admin/aum/growth/collective{,/preview}`.

Missing: **all web auth, all `/v1/client/*`, `/newuser`, `/v1/app-config`, `/v1/app/update`,
all `/v1/public/*` content, all health, and every admin route except funds and AUM** —
session, applications, email-deliveries, users, audit-logs, faqs, app-config, client-growth,
fund-receipts, refunds, payments, mandates, mandate-collections. Plus all provider webhooks,
which are not even in the drift baseline because no frontend calls them.

Three mismatches to fix in Phase 0:

1. `GET /v1/public/consent-documents` is contracted and generated but **has no backend
   implementation** — `grep` over `src/` finds only `publicContentRoutes.ts`'s three
   documents. It would 404.
2. `src/errors.ts` has **22** codes; the backend has **24**. Missing:
   `PROVIDER_CALLBACK_UNVERIFIED` and `MOBILE_CHECKOUT_DISABLED`. A frontend using
   `ErrorCode` from the package cannot type-narrow `MOBILE_CHECKOUT_DISABLED`, which
   `POST /v1/client/orders/:orderId/pay` really returns.
3. There is **no `page` metadata shape**, so paginated responses are not describable through
   `createSuccessEnvelopeSchema` as currently used. Every list endpoint needs it.

### The drift checker constrains the whole plan

`scripts/check-frontend-contract-drift.mjs` is **a ratchet on the legacy frontend, not a
contract enforcer**. It walks `frontend_stack/packages/{client,admin,shared}`, extracts every
`/v1/...` string literal, normalises `${…}` / `:param` / trailing id segments to `{param}`,
separately extracts `apiRequest(...)` / `fetch(...)` call sites to recover the method, diffs
against the OpenAPI paths, and compares the result to
`scripts/frontend-contract-drift-baseline.json` (60 `uncontractedPaths`, 1
`uncontractedMethods`). It fails in **both** directions.

`frontendRoot` and `SERVICE_DIRECTORIES` are **hardcoded**. Three consequences:

- A new frontend outside `frontend_stack/packages/{client,admin,shared}` is **invisible** to
  the check and gets no drift protection at all.
- Deleting or renaming the legacy frontend makes `discoverFrontendPaths` throw `ENOENT` on
  `readdir(frontendRoot)` — only the *baseline file* read is ENOENT-tolerant — breaking
  `npm run check` and therefore the `contracts` CI job.
- Removing legacy call sites **resolves** baseline entries and fails the check until the
  baseline is regenerated with `--write-baseline`.

The baseline also contains normalisation artefacts worth knowing about: a literal `/v1/admin/*`
glob, `/v1/admin/refunds/{param}/{param}` collapsing `retry` and `reconcile`, and
`/v1/client/sips/{param}/{param}` collapsing pause, resume and cancel.

## Required backend corrections

Small, specific, and each one blocks or degrades a frontend surface.

| # | Correction | Why | Proposal |
|---|---|---|---|
| BC1 | **AutoPay mandate authorisation has no browser path.** `postAutoPay` returns a native SDK token; `browserPlatform.start` returns `unavailable`. | Web AutoPay is unbuildable | Product decision. Either add a hosted/redirect channel to `clientAutoPaySipRoutes.ts` mirroring `postPay`'s `checkoutChannel` discriminator, or declare AutoPay Android-only and have the web UI say so explicitly. |
| BC2 | **`GET /v1/public/consent-documents` is contracted with no implementation.** | A generated client will 404 | Either implement it over `consentRepository.findCurrentDocuments`, or delete the operation from `packages/contracts/src/operations/public.ts` and regenerate. |
| BC3 | **`packages/contracts` is missing 2 error codes and the `page` meta shape.** | Paginated and payment responses are not typeable | Add `PROVIDER_CALLBACK_UNVERIFIED`, `MOBILE_CHECKOUT_DISABLED`, and a `PageMeta` schema. |
| BC4 | **The drift checker cannot see a frontend outside `frontend_stack`.** | No protection for the new frontend; breaks CI at Phase 12 | Parameterise `frontendRoot` and `SERVICE_DIRECTORIES` (env var or CLI flag), tolerate a missing root, and add the new frontend as a second scanned root. |
| BC5 | **New frontend origin absent from `WEB_ORIGIN_ALLOWLIST`.** | Every browser response discarded | Add the dev origin before the first authenticated request; keep `https://localhost` for the APK. |
| BC6 | *(cleanup, not blocking)* `POST /v1/client/email-verification/resend` is a pure alias of `/start`. | Two paths, one behaviour | Remove `/resend` under the forward-only rule once the new frontend stops calling it. |
| BC7 | *(cleanup, not blocking)* `POST /v1/admin/applications/:id/decision` takes `?outcome=` with a strict-empty body. | Guaranteed `VALIDATION_FAILED` for anyone who guesses | Either move `outcome` into the body, or document it loudly in the contract. |
| BC8 | *(consider)* No bulk `mark all notifications read` endpoint. | The legacy button does nothing | Either add `PATCH /v1/client/notifications` or drop the affordance. |
| BC9 | *(consider)* `GET /v1/client/transactions` ignores a filter the UI wants. | Filtering happens client-side over `limit=100` | Add server-side filter parameters, or accept client-side filtering as the contract. |
| BC10 | *(consider)* Fund detail cache is never invalidated on publish. | Stale fund data until TTL | Call `cache.invalidatePrefix(CACHE_PREFIXES.funds)` from `createFundVersion` and `patchFund`. The method already exists and is never called. |

## Amendment — 2026-08-29 · read this before trusting anything above

This document was written when `packages/contracts` covered 15 paths / 19 operations. **It now covers
84 paths / 94 operations** and is generated into `packages/contracts/generated/openapi-v1.json`.
Every endpoint this document lists under a "Missing:" heading is now contracted. For current
coverage, read `packages/contracts` — it is machine-checked and this prose is not.

Specific statements above that are now **wrong**:

| This document says | Reality |
| --- | --- |
| `/v1/client/sips/autopay`, `…/autopay/:sipPlanId`, `…/cancel`, `…/setup/retry` | Renamed to `/v1/client/sip-autopay*` (D-032) — the old path was ambiguous against `/v1/client/sips/{sipPlanId}/pause` under the OpenAPI path model |
| AutoPay returns `{checkout:{type:"phonepe_sdk", token, merchantId, environment}}`, "this is the blocker" | Hosted redirect. `checkout: HostedCheckout.nullable()`. The native SDK path, its token and the encrypted token storage were all removed (D-011) |
| `MOBILE_CHECKOUT_DISABLED` is a live wire code missing from contracts | Removed from **both** sides. The AutoPay routes now throw `DEPENDENCY_UNAVAILABLE` |
| Backend has 24 error codes, contracts 22 | Both are **23**, and the sets are identical |
| FAQ publish/unpublish uses `PATCH /v1/admin/faqs/:faqId` with `{status}` | Split to `PATCH /v1/admin/faqs/:faqId/status` (D-032). The old route dispatched on body key-count, so `{"status":"published","order":3}` was silently reinterpreted then rejected |
| The drift checker walks `frontend_stack/packages/{client,admin,shared}` with a 60-entry baseline | That script and its baseline were deleted (D-030). `check-frontend-contract-bypass.mjs` replaces them |
| `If-Match` guards admin fund concurrency | `parseIfMatchVersion` has **zero callers**. `patchFundState` guards with a row lock plus a transition table instead, and the frontend sends `ifMatch` from exactly one hook, where it is inert |
| Response field `emailVerificationStatus` on `/v1/client/email-verification-status` | The route now returns `emailVerificationState`, matching the contract and the rest of the app (D-038). `admin-oversight` deliberately keeps `emailVerificationStatus` and is self-consistent |

### Mandatory backend corrections — final state

| BC | Status |
| --- | --- |
| BC1 AutoPay browser path | done (D-011) |
| BC2 `consent-documents` implemented | done, fails closed 503 on an absent or ambiguous pair |
| BC3 error codes + `page` meta | done |
| BC4 parameterise the drift checker | done, then superseded by D-030 |
| BC5 `WEB_ORIGIN_ALLOWLIST` | deployment env. `.env.example` carries `http://localhost:5174` but **not** `:5175`, the admin dev port — admin dev login depends on an entry the example does not show |
| BC6 remove the `/resend` alias | **done 2026-08-29** |
| BC7 `?outcome=` on the decision route | not done, but mitigated: the query is now contracted as a strict enum, so a generated client cannot get it wrong |
| BC8 bulk mark-all-read | not done; the frontend has no bulk affordance, so nothing is broken |
| BC9 server-side transaction filtering | **not done, and moot as written.** It existed because the legacy frontend fetched everything and filtered locally. The new frontend has no ledger filter UI at all, so there is no client-side filtering to move. The real underlying defect is the absence of cursor pagination — see the README's open-gaps list |
| BC10 invalidate the fund cache on publish | **done 2026-08-29**, with route-level integration tests. This closes risk R24 |
