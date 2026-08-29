# Risks and Decisions

Every decision that constrains later work, with its reasoning and its reversibility. Referenced by
[`implementation_log.md`](implementation_log.md) and the task logs in [`../TASK/`](../TASK/).

Status vocabulary: **DECIDED** · **OPEN** — needs a maintainer or product answer ·
**DEFERRED** — decided to decide later, with the trigger named · **SUPERSEDED**

---

## Decisions

### D-001
**Contract coverage is extended per feature phase, not up front.** · DECIDED 2026-08-27

The original plan made Phase 0 "extend `packages/contracts` to full coverage before any UI".
Measured cost: ~75 operations at roughly 100 lines each (`admin-fund-aum.ts` is 782 lines for 8),
so ~7,000 lines of descriptors written blind before a single screen exists.

Two things make incremental extension safe, and neither existed when the original plan was
written. First, `check-frontend-contract-drift.mjs` now scans `frontend_stack_ts/src` (D-004), so
the moment the new frontend calls an uncontracted path, CI fails — the guard that was missing while
the legacy frontend accumulated 60 uncontracted paths. Second, each phase's descriptors are written
against a screen that immediately exercises them, so they are verified rather than assumed.

**Risk accepted:** a phase may discover a contract shape late and have to revise a descriptor.
Cheap, because the descriptor and its consumer land together.
**Reversible:** yes. Nothing prevents a bulk pass later.

### D-002
**Backend corrections are mandatory, but made in the phase that consumes them.** · DECIDED 2026-08-27

The application is pre-production with no real users, and `frontend_stack` is scheduled for
deletion. So the API contract is shaped for the new frontend and the legacy frontend is allowed to
break as a consequence. Doc 04's corrections are promoted from "consider" to mandatory, and
`AGENTS.md` forward-only explicitly supports removing superseded paths rather than accommodating
them.

They are **not** made speculatively ahead of the consuming phase, for a reason unrelated to
legacy: an unconsumed API change is an unverified one, and until the new frontend reaches parity,
`frontend_stack` is the only working end-to-end system on the dev stack. Breaking it early costs
the only integration surface available for ten phases.

Assignment: BC6 → Phase 4 · BC10 → Phase 5 · BC9 → Phase 6 · single checkout shape → Phase 7 ·
BC1 and the `mobileSdk`/`MOBILE_CHECKOUT_DISABLED` renames → Phase 8 · BC8 → Phase 9 ·
BC7 → Phase 10.

**Risk accepted:** legacy frontend surfaces degrade progressively as corrections land. Acceptable;
it is being retired and has no users.

### D-003
**Migration 043 is verified with the new frontend at new-stack deploy time.** · DECIDED 2026-08-27 (maintainer)

Verified read-only on the dev stack: 33 migrations applied, latest `042`, and `payment_attempts`
still carries `payment_attempts_sdk_dispatch_channel_check` — the 035 constraint that excludes
`hosted_redirect`. So the deployed database would currently reject every hosted-checkout dispatch
write.

Migration ordering is **structural, not procedural**: the compose `migrate` service runs
`npm run migrate` from the backend image with `depends_on: postgres service_healthy`, and the
backend depends on its completion. So 043 applies automatically on the next deploy once it is in
the image — there is no separate manual step to forget.

Maintainer decision: verify it together with the new frontend when the new stack is deployed, with
a schema backup taken as part of that deploy. It therefore does **not** gate Phase 1.
**It remains a hard prerequisite for Phase 7**, the first phase whose code depends on the relaxed
constraint.

**Reversibility:** `rollback.sh --dev --to <version>` performs an image-only rollback, which is
safe and cheap. 043 only relaxes a CHECK, so leaving it applied is harmless. Rolling the *backend*
back past the 0.11.9 schema boundary requires `--restore-db`, which drops and recreates the
database from a snapshot and loses post-snapshot transactions — it does back up current first.

### D-004
**Drift-checker scan roots are configurable and tolerate absence.** · DECIDED 2026-08-27

`BOE_FRONTEND_SCAN_ROOTS`, comma-separated and repository-relative, defaulting to the three legacy
package directories plus `frontend_stack_ts/src`. Missing roots are skipped; all roots missing
throws.

The throw matters more than the configurability. The old code would have failed with an opaque
`ENOENT` at cutover; a naive fix would have made it report "0 paths, no drift" — a false green on
a contract gate. Failing loudly is the only safe behaviour.

### D-005
**Cutover target for the drift baseline is `uncontractedPaths: []`.** · DECIDED 2026-08-27

The current 60-entry baseline records *legacy* drift and must not be inherited by the new frontend.
At Phase 12 the baseline is emptied and only `frontend_stack_ts/src` is scanned. Enforced by
D-004's env variable, a one-line change.

### D-006
**`frontend_stack_ts` is a fourth independent npm project.** · DECIDED 2026-08-27

The repository root has **no npm workspaces** — `backend_controller`, `packages/contracts` and
`frontend_stack` are each standalone with their own lockfiles. Matched that convention rather than
introducing a workspace, which would have coupled install and lockfile resolution across
independent deployables.

Conventions adopted from `packages/contracts`: exact version pins with no carets, `engines`
`node >=22.19.0 <23` and `npm >=11.16.0 <12`, `packageManager: npm@11.16.0`, and an `allowScripts`
policy.

Dev port **5174** and package name **`@beonedge/frontend-ts`** chosen as defaults in the absence of
a stated preference. The port is what B5 must add to `WEB_ORIGIN_ALLOWLIST`.

### D-007
**zod must stay major-aligned with `packages/contracts`.** · DECIDED 2026-08-27

The frontend consumes contract schemas directly, so a major mismatch would break type inference
and runtime parsing. `packages/contracts` is on `zod@4.4.3`; the frontend pins the same exact
version. An initial install of zod 3 was corrected before any source was written.

This is a standing constraint, not a one-off: any future bump must move both together.
Doc 07 did not flag it.

### D-008
**React 19 and Router 7, despite the legacy app being on React 18.3.1 and Router 6.26.2.** · DECIDED 2026-08-27

Greenfield, and the two frontends share no code, so there is no compatibility argument. Two active
reasons to move: `react-router` 6.0.0 through 7.17.0 carries a moderate security advisory fixed
only above 7.17.0, and doc 07 already specified both majors. Result: `npm audit` reports 0
vulnerabilities.

Adopted **Vite 6.4.3** rather than doc 07's stated Vite 7, matching the version proven in
`packages/contracts`.

### D-009
**No fixture or demo mode, at all.** · DECIDED 2026-08-27

The legacy `serviceMode()` returns `'fixture'` unless `VITE_BEO_API_MODE === 'http'`, and five
fixture modules are imported at module scope by the services themselves — three of the five are
empty arrays. A default build therefore signs in as a fake user with a hardcoded ₹12,38,450
portfolio and no history. Admin compounds it: `loadAdminData.js` silently returns fake FAQs while
`useAdminList.js` refuses and says so, giving two contradictory offline behaviours in one console.

`VITE_BEO_API_MODE` is retained only as an explicit assertion at boot. If it is not `http`, the app
renders a single configuration-error screen. This also satisfies `rules.md` §4 — a failed read is
never rendered as emptiness.

### D-010
**The API base is resolved at runtime, not baked in.** · DECIDED 2026-08-27

`DEPLOYMENT_CONSTRAINTS_IMPLEMENTATION.md` records that because the API base is baked into each
Vite build, dev and prod archives are **not byte-identical promotable artifacts**, and that the fix
is to make it runtime-relative. A greenfield frontend is the place to do that.

Resolution order: injected `window.__BOE_API_BASE__` → build-time
`VITE_BEO_API_BASE_URL` → same-origin `/api` in a browser → hard failure in a Capacitor WebView.

The last rule is deliberate: `https://localhost` has no server to be same-origin with, so an APK
must always carry an absolute `https://` origin — which is why `emu/boe_update.sh` refuses to build
a target whose API origin is not `https://`.

---

## Open

### D-011
**AutoPay mandate authorisation uses hosted checkout.** · DECIDED 2026-08-28

`POST /v1/client/sips/autopay` returns `{type:'phonepe_sdk', token, merchantId, environment}` and
requires a native bridge; in a browser `browserPlatform.start` returns `{status:'unavailable'}`.
One-time payments were migrated to hosted redirect; AutoPay was not.

Options: **(a)** add a hosted/redirect channel mirroring `postPay`'s `checkoutChannel`
discriminator, or **(b)** declare AutoPay Android-only and have the web UI say so explicitly
rather than showing a broken button.

Not decidable from the repository — whether PhonePe's Subscriptions API can return a hosted
redirect for mandate authorisation is an external-provider fact. Per D-002, whichever is chosen,
the other path is deleted rather than kept.

Resolution: the backend now uses PhonePe's hosted `POST /checkout/v2/pay` subscription setup and
returns `{checkout:{type:'redirect',url}}`. The native SDK token path and its encrypted token
storage/configuration were removed. A completed provider dispatch persists the validated hosted
URL through its expiry so a lost HTTP response is recoverable without another PhonePe POST. Only
an ambiguous `dispatching` replay returns `checkout: null`; the frontend must reconcile that state.

### D-012
**`GET /v1/public/consent-documents` is implemented.** · DECIDED 2026-08-28

Deleting it is the forward-only instinct, but it is plausibly contracted *because* the marketing
site must display terms and privacy before capturing consent — and `POST /newuser` already reads
`consentRepository.findCurrentDocuments` server-side, so the data exists and only the GET is
missing. A product question about the signup flow, not dead code.

Removing it also means rewriting `public.test.ts` (223 lines) and emptying `PUBLIC_OPERATIONS`.

Resolution: retain and implement the route. It returns exactly the current terms/privacy pair and
fails closed with `503` when the pair is absent, incomplete, or ambiguous.

### D-013
**Email verification uses one durable vocabulary.** · DECIDED 2026-08-28

Migration `040`'s CHECK allows `not_started | pending | verified | rejected`. Prior implementation
logs describe projections using `verified` and `pending_verification`. These are two vocabularies
for one concept. Needs confirmation of what the API actually returns on the wire. Note `'rejected'`
is permitted by the CHECK and **written by no code path**.

Resolution: the persisted and wire vocabulary is `not_started | pending | verified` under
`emailVerificationStatus`. Email OTP codes expire; successful Email OTP Verification does not.
Migration 045 removes the unused `rejected` state and verification expiry column while preserving
verified identities and `email_verified_at`.

### D-014
**Account lifecycle stays; refund initiation remains closed.** · DECIDED 2026-08-28

`POST /v1/admin/users/:id/{suspend,reinstate,close}` and `GET /v1/admin/users/:id/login-events`
have no caller anywhere in the admin package, and `users.suspend`/`users.close` are absent from
`nav.js` while existing in the database. Either surface them in Phase 10 or prove them obsolete.

Separately: **nothing in the codebase creates a refund row.** `refundRepository.create` exists with
no caller, so the admin refund retry and reconcile endpoints operate on rows no code path produces.
Is refunding a product feature?

Resolution: keep suspend/reinstate/close and login events for the admin UI. Suspend and close now
revoke all user sessions in the same database transaction; reinstate never resurrects them. Do
not add refund initiation: the current accounting model has no atomic client-value/allocation
reversal, so creating refunds would overstate portfolio value. Existing reconciliation remains
fail-closed pending a separately designed refund accounting capability.

### D-015
**Release the backend contract slice as `0.11.10`.** · DECIDED 2026-08-28

`VERSION` is already `0.11.9` and commit `0347ee7` already tagged it, so the uncommitted
hosted-checkout slice needs either a new version or an amended release decision.

Resolution: root `VERSION` is `0.11.10`; tagged `0.11.9` is not amended.

---

## Standing risks

| # | Risk | Mitigation | Verification |
|---|---|---|---|
| R-01 | Duplicate payment | Idempotency key re-minted only on body change; writes never auto-retried; one-writer dispatch claim; `payments_order_uk` | Unit TESTED; outcome VPS only |
| R-02 | Return from PhonePe misread as success | UI shows *pending* on return, always; only server state settles | Phase 7 |
| R-03 | Safe-area failure, silently | Four cooperating mechanisms; source contract test | Source TESTED; device VPS only |
| R-04 | Blank screen from a cyclic chunk graph | `check-android-dist.mjs` acyclicity check; `check-bundle-boots.mjs` JSDOM boot | Phase 1 |
| R-05 | Session family revoked by parallel refresh | One in-flight refresh promise per scope | Phase 3, unit TESTED |
| R-06 | Contract drift in the new frontend | D-004 plus D-005 | CI |
| R-07 | Lockfile CI cannot reproduce | Installs run through `npx npm@11.16.0`; this machine has npm 12.0.1 | TESTED |
| R-08 | Legacy frontend degrades as corrections land | Accepted per D-002; it is being retired | — |


### D-016
**`engines` admits Node 24 while `.nvmrc` stays canonical at 22.20.0.** · DECIDED 2026-08-27

`.npmrc` sets `engine-strict=true`, matching `packages/contracts`. The repo standard is
`node >=22.19.0 <23` and `npm >=11.16.0 <12`, but this development machine runs Node 24.18.0 and
npm 12.0.1, and no version manager is installed — so installs were refused outright.

Widened to `node >=22.19.0 <25`, `npm >=11.16.0 <13`. Reproducibility is not weakened: CI resolves
Node from `.nvmrc` via `actions/setup-node`'s `node-version-file`, and the exact dependency set is
fixed by `package-lock.json`. The upper bound was expressing a preference, not a guarantee.

Installs on this machine are run through `npx npm@11.16.0` so lockfile writes match the version CI
uses.

### D-017
**Only `src/api/http.ts` may call `fetch`, enforced by lint.** · DECIDED 2026-08-27

The legacy frontend has two transports: `services/_util.js` and, unintentionally,
`shared/src/appConfig.js`. A third bypass exists at `services/appUpdate.js:81`, which uses raw
`fetch` deliberately because it runs before any session exists and must not enter the 401-refresh
machinery.

The new frontend keeps one transport and expresses that exception **inside** it as an
`unauthenticated: true` option, rather than bypassing it. Enforced by a `no-restricted-syntax` rule
on `CallExpression[callee.name='fetch']`, disabled only for `src/api/http.ts` and test files.

### D-018
**Layer boundaries are lint-enforced, not conventional.** · DECIDED 2026-08-27

`ui/` cannot import `features/`, `shells/` or `app/`. `features/` cannot import `shells/` — a
feature must not know which shell renders it, which is what keeps one feature layer serving both
presentations. `domain/` cannot import any presentation layer.

Implemented as per-layer scoped `files` overrides with `no-restricted-imports` `patterns[].group`.
An initial attempt used `target`/`from`, which is an `eslint-plugin-import` API and not valid core
ESLint — it failed config validation rather than silently doing nothing.

### D-019
**`paiseToRupees` throws rather than truncating.** · DECIDED 2026-08-27

`Paise` is bounded by PostgreSQL bigint, so a value can exceed `Number.MAX_SAFE_INTEGER`.
`Number(paise)` would silently lose precision. Since the only purpose of the conversion is display,
and a silently wrong money figure is worse than a visible failure, `paiseToRupees` raises
`MoneyPrecisionError` outside the safe range. Arithmetic (`addPaise`, `subtractPaise`,
`comparePaise`) uses `BigInt` throughout and is unaffected.

Recorded because it is a deliberate asymmetry: the domain type is wider than the display path.


### D-020
**`@beonedge/contracts` is consumed through a build alias, not an npm dependency.** · DECIDED 2026-08-28

The frontend needs the contract descriptors and their zod schemas at runtime. Two ways to get them:

**(a) `"@beonedge/contracts": "file:../packages/contracts"`.** Honest — the package declares
`files: ["dist"]` and subpath exports, so consuming `dist` is its intended contract. Rejected for two
concrete reasons. First, `frontend_stack_ts/.npmrc` sets `engine-strict=true` and
`packages/contracts` declares `engines` `node >=22.19.0 <23` / `npm >=11.16.0 <12`, while this
machine runs Node 24.18.0 and npm 12.0.1 — the same conflict D-016 already had to widen the
frontend's own `engines` to work around, and a `file:` dependency would reintroduce it from the
dependency side where widening is not available. Second, `npm ci` would need `dist` to exist at
install time, coupling install order across two independent projects.

**(b) A resolver alias**, mapping `@beonedge/contracts` to `../packages/contracts/dist/index.js` in
`vite.config.ts` and `vitest.config.ts`, and to `dist/index.d.ts` in `tsconfig.json` `paths`.
Chosen. This is the pattern `frontend_stack/app/vite.config.js:16-23` already uses for
`@beonedge/{design-tokens,shared,client,admin}`, so it is repo-proven. `zod` resolves from the
frontend's own `node_modules`, which D-007 already pins to the identical `4.4.3`.

The cost is explicit and paid: the `frontend-ts` CI job must build `packages/contracts` before
installing, and that step is now in `.github/workflows/ci.yml`. If it is ever removed, the frontend
fails at typecheck with an unresolved module rather than silently degrading.

**Reversible:** yes. Switching to (a) is a `package.json` edit plus removing three alias entries,
and becomes attractive the moment the repo adopts workspaces or contracts relaxes its `engines`.

### D-021
**No `ui/tokens/kit.css`. The legacy kit is a global class vocabulary, not a token layer.** · DECIDED 2026-08-28

Doc 10's Phase 1 file list and doc 11's token table both call for porting
`design-tokens/src/kit.css`. Inspected before porting: `kit.css` is a 3-line `@import` shim, and
`kit-core.css` (178 lines) is almost entirely the global `be-*` component vocabulary — `.be-btn` and
its nine variants, `.be-input`, `.be-field`, `.be-card`, `.be-badge` and its six tones, `.be-eyebrow`,
`.be-money`, `.be-gain`, `.be-loss`.

That is precisely what this rebuild rejects. Doc 08 lists "a second class vocabulary" as a forbidden
anti-pattern, and doc 07 chose CSS Modules specifically so class names are locally scoped by
construction. Porting `kit.css` would reinstate the global vocabulary that the styling decision
exists to eliminate, and `be-btn` hand-written 58 times across legacy pages is the direct evidence of
how that ends.

The only part worth keeping — the element-level reset, focus-visible ring, margin normalisation and
`prefers-reduced-motion` block — is **already in `src/index.css`** from Entry 008. The component
styles become `.module.css` files on the 24 primitives from Phase 2 onward.

**Consequence:** docs 10 and 11 are wrong on this row and should be corrected.

### D-022
**The API-client generator is `.mjs`, not `.ts`.** · DECIDED 2026-08-28

Doc 07 and doc 10 both name `scripts/generate-api-client.ts`. Running a TypeScript script needs a
loader; `packages/contracts` has `tsx` for exactly this, the frontend does not. Adding `tsx` to
carry one build-time script is a dependency for nothing, and the two existing gates
(`check-android-dist.mjs`, `check-bundle-boots.mjs`) are already `.mjs` and already excluded from
lint. Matched them.

The generator discovers operations by **structural inspection** of the contracts module namespace
rather than by reading a hardcoded list of collections, because `operationId` and export name
diverge — `nativeLogout` carries `operationId: "logoutNativeSession"`. It fails loudly if the
contracts `dist` is absent, if no descriptor is found, or if two operations share an `operationId`.

### D-023
**The transport validates the full success envelope, then unwraps `data`.** · DECIDED 2026-08-28

Every contracts operation sets `success.schema` to the result of `createSuccessEnvelopeSchema(...)`,
so the schema describes `{ok, data, error, meta}` and not the payload. Doc 07's illustrative
descriptor — `success: { status: 201, schema: OrderCreated }` — reads as a data schema and would
have produced a transport that fails validation on every single response.

So `request()` parses the whole body against `success.schema`, returns `{data, meta}`, and treats a
parse failure as `TransportError("malformed")` rather than as an application error. It also compares
the HTTP status against `success.status`, because a contracted 201 arriving as 200 is a contract
break that should surface rather than pass silently.

**Consequence:** doc 07's API-layer example is misleading and should be corrected.


### D-024
**Chunking splits `node_modules` only; all first-party source stays in one chunk.** · DECIDED 2026-08-28

`check-android-dist.mjs` builds its chunk-import graph by substring-matching chunk filenames in
emitted source. It therefore counts a **dynamic** import as an edge, exactly like a static one.

The consequence is structural: a chunk holding the route manifest dynamically imports every screen,
and every screen imports something shared. Whatever chunk that shared code lands in becomes part of
a cycle. Two arrangements were tried and both were correctly rejected —
`ActivityScreen → ClientShellRoot → ActivityScreen`, then
`ActivityScreen → PendingScreen → core → ActivityScreen`.

This is not a checker defect. `rules.md` §5 is explicit that a cycle across a chunk boundary is a
launch crash invisible to unit tests, and v0.9.0 shipped precisely that. The legacy client build
satisfied the same constraint the same way: client pages were never split out of the client chunk.

So `manualChunks` splits `react`, `react-router`, `@tanstack`, `zod` and the remaining
`node_modules`, and returns a single `app` chunk for everything under `src/`. Route-level `lazy()`
is retained because it is how the router is generated and it still helps the dev server, but the
build folds the screens back together.

Measured result: 16 assets, 586,621 bytes total against a 1,400,000 ceiling, largest JS 193.69 kB
against 320 kB, and 7 chunks that all evaluate in JSDOM.

**Reversible:** yes, but only against a different cycle checker. Admin-side domain splitting stays
available because `check-android-dist.mjs` runs for the client variant only.

### D-025
**Routes whose phase has not landed render an explicit not-implemented state.** · DECIDED 2026-08-28

Both manifests declare the full target route map from Phase 2, not a subset that grows. That makes
`routeIntegrity.test.ts` meaningful immediately — every parent target, nav entry and inbound link is
checked against the real map rather than against whatever happens to be built.

The cost is 47 routes with no feature behind them. They render a `PendingScreen` that says the
surface is not implemented in this build and that it is a declared route rather than a failed load.
That distinction is the point: `rules.md` §4 forbids rendering absence as emptiness, and a blank
screen behind a working nav tab is indistinguishable from a broken one.

Each feature phase replaces one placeholder with a real screen. A placeholder is never a stub that
pretends to work — the legacy Explore "notify me" button, which set a local toast and called no
API, is the failure mode being avoided.

### D-026
**Auth screens take a shell-provided port rather than branching on target.** · DECIDED 2026-08-28

Client and admin authenticate differently and irreconcilably: the client uses
`/v1/auth/native/login` with a bearer token and a device record, while the browser admin console
uses `/v1/auth/web/login` with HttpOnly cookies and a CSRF synchroniser. The Android admin build is
a third case — it is served from `https://localhost`, cross-site with the API, so `SameSite=Lax`
plus the `Sec-Fetch-Site` gate make cookie auth impossible and it must use the bearer path.

Rather than duplicate the login screen per target, or branch inside it on
`import.meta.env.VITE_BEO_APP_TARGET`, each shell supplies an `AuthPort`: `login`, `logout`,
`probeReachability`, and the paths and audience label the screens need. `LoginScreen`,
`SplashScreen`, `BlockedScreen` and `NotFoundScreen` are written once against that port.

This keeps the transport specifics in `clientRuntime.ts` and `adminRuntime.ts`, where the
scope-specific token store, refresh executor and rotation identifier already live, and it means the
Android admin variant becomes a port swap rather than a screen fork.


### D-027
**Both shells resolve the API same-origin through an `/api` proxy in development.** · DECIDED 2026-08-28

The admin console could not authenticate at all when the SPA was served from `localhost:5175` and
the API called at `127.0.0.1:47502`. Those are different hosts to a browser, so the exchange is
cross-site: `SameSite=Lax` cookies are never stored, and `validateWebOrigin` rejects on
`Sec-Fetch-Site: cross-site` before any handler runs. Observed directly — login answered 200 with
`Set-Cookie`, and the browser held zero cookies.

Doc 01 already records this as a shipped production failure for the admin image, where baking the
user SPA's absolute origin "failed three ways at once — CORS, `validateWebOrigin()` rejecting
`Sec-Fetch-Site: cross-site`, and `Secure`/`__Host-` cookies not being sent cross-site", with the
visible symptom that the admin splash never released. The recorded resolution is that the console is
served from a host whose vhost proxies `/api/` itself.

So development now matches that: `vite.config.ts` proxies `/api` to the backend with the prefix
stripped, and `VITE_BEO_API_BASE_URL` is left unset so `resolveApiBase()` falls through to its
same-origin `/api` branch. Both shells use it.

Two things this buys beyond fixing the bug. The same-origin branch of `resolveApiBase()` is now
actually exercised rather than reasoned about, and that branch is the one D-010 added to make the
browser images byte-identical promotable artifacts — the limitation
`DEPLOYMENT_CONSTRAINTS_IMPLEMENTATION.md` asks a future change to remove. And the development
topology now mirrors production instead of diverging from it, so a cookie or origin defect surfaces
locally rather than at deploy.

The APK remains the deliberate exception: a Capacitor WebView on `https://localhost` has no server
to be same-origin with, so it must carry an absolute `https://` origin, which is why
`resolveApiBase()` throws rather than guessing there.


### D-028
**The CSS and total-asset ceilings are raised to fund a high-end visual layer.** · DECIDED 2026-08-28 (maintainer)

`check-android-dist.mjs` enforced largest CSS ≤ 160 kB and total assets ≤ 1400 kB. Those numbers were
inherited from the legacy build, where the entire client stylesheet loaded on every route and the
budget was the only thing standing between the APK and a bloated bundle.

Maintainer direction: there is no such requirement. The visual quality of the product matters more
than the byte count, on both mobile and desktop. Raised to **largest CSS ≤ 640 kB** and **total
assets ≤ 2600 kB**.

What does **not** change, and why the raise is safe:

- **The acyclicity check stays.** A cycle across a chunk boundary is a launch crash and is invisible
  to unit tests (v0.9.0 shipped exactly that). Bytes were never the real risk; boot order was.
- **`check-bundle-boots.mjs` stays.** Every chunk is still evaluated in JSDOM.
- **The font rules stay.** woff2 only, no cyrillic/greek/vietnamese subsets. The APK packages every
  emitted asset, so unused font subsets are still dead weight with no upside.
- **The cross-target asset check stays.** A client build containing an admin asset is still a defect.
- **CSS Modules remain the styling choice.** The 160 kB ceiling was only the *first* of the reasons
  recorded in doc 07. The load-bearing reason is unchanged: locally-scoped class names structurally
  prevent the four-vocabulary collision (`be-*` / `apk-*` / `adm-*` / `ash-*`) that is the legacy
  frontend's defining defect, and the safe-area token contract is test-enforced. Lifting a byte
  budget is not an argument for a utility framework, and switching now would rewrite every component
  for no design gain.

Doc 07's Tailwind rejection and doc 08's budget table are amended in place.
