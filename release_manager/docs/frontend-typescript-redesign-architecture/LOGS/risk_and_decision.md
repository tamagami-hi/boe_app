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


### D-029
**Money renders in the body sans with tabular figures, not in a monospace typeface.** · DECIDED 2026-08-29

Doc 10 phase 6 requires that "money renders in tabular mono figures so values do not shift layout".
That was implemented literally: `MoneyValue` used `--be-font-mono` (JetBrains Mono). Reading the
screenshots showed why the literal reading was wrong. `₹51,25,000` in a monospace face on a warm
ivory editorial surface reads as terminal output, and the rupee sign fell back to a different face
than the digits because the loaded subset did not cover it at that weight.

The requirement is **tabular figures**, so a changing value cannot shift the layout. It is not a
requirement for a monospace *typeface*. Instrument Sans carries `tnum`, so
`font-variant-numeric: tabular-nums lining-nums` satisfies the requirement in the body face, at a
heavier weight and tighter tracking than prose.

`--be-font-numeric` is now its own token so the choice is made once. `--be-font-mono` is kept and
still used where a monospace face is the point rather than an accident: slugs, content keys, request
ids, uuids, hashes and the app-config JSON editor.

### D-030
**The frontend contract-drift check is replaced by a contract-bypass check.** · DECIDED 2026-08-29

`check-frontend-contract-drift.mjs` scanned frontend source for literal `/v1/...` strings, normalised
them, and compared the set to the OpenAPI document, carrying a baseline of known gaps. That was the
right check for the legacy frontend, where every service module hand-wrote its own paths.

Pointed at `frontend_stack_ts` after the legacy tree was removed, it reported **zero paths** and
therefore zero drift. It had become vacuous: the new frontend never writes a path, it passes an
operation descriptor imported from `@beonedge/contracts` to one transport.

Deleting the check would have removed the guard entirely. Instead it is replaced with the invariant
that actually holds now, and which the architecture depends on:

1. No literal `/v1/...` path may appear anywhere in `frontend_stack_ts/src`, except in the generated
   client itself. A path written by hand means a request that bypassed the contract layer.
2. The generated client must expose exactly as many operations as the contracts define, so a
   contract added without regenerating is caught here as well as by `generate:api:check`.

Test files are exempt, because `http.test.ts` legitimately constructs synthetic operations against
`/v1/probe` to exercise the transport itself.

The baseline file is gone with the old script. A baseline was a way of tolerating known legacy gaps;
there is nothing left to tolerate.

### D-031
**The Android project and deployment files were ported into the new tree before the legacy tree was
deleted, not after.** · DECIDED 2026-08-29

The maintainer's sequence was: finish the web build, retire `frontend_stack`, re-test, then start the
APK. Phase 11 of doc 10 requires porting `android/`, `resources/launcher/`, `capacitor.config.ts`,
the Dockerfile and `nginx.conf` **out of** `frontend_stack`, and lists a table of settings that must
move verbatim because each one exists because of a shipped defect. Three `release_manager` tests also
assert directly on those files.

Deleting first would have meant recovering them from git history to satisfy the very next task, and
would have left `runtime_contract`, `hermetic_branding` and `apk_logging_policy` failing in between.
So the port happened first, in the same commit as the deletion. The end state is identical to the
documented order; only the intermediate state differs, and it is never broken.

What was deliberately **not** carried across: `android/app/src/main/assets/` (the legacy web bundle,
regenerated by `cap sync`), `capacitor-cordova-android-plugins/` (generated), `local.properties`
(machine-local), and every Gradle build directory.

### D-032
**The FAQ PATCH route is split in two rather than dispatching on the body's shape.** · DECIDED 2026-08-29

`PATCH /v1/admin/faqs/:faqId` decided what it was doing by inspecting the request body: exactly one
key, named `status`, meant a lifecycle transition; anything else was parsed as a content edit. So
`{"status":"published","order":3}` fell through to the content branch and was rejected for an
unrecognised key, and there was no way to express "publish" and "reorder" together or to tell from
the URL which operation a client intended.

It also cannot be modelled: two operations may not share one method and path in OpenAPI, and
`operation-operationId-unique` is enabled deliberately.

Lifecycle now lives at `PATCH /v1/admin/faqs/:faqId/status`; content editing keeps
`PATCH /v1/admin/faqs/:faqId`. The idempotency route templates differ accordingly, which is correct:
they are different operations and should not share a replay scope.

The same reasoning produced the earlier rename of the AutoPay collection from
`/v1/client/sips/autopay` to `/v1/client/sip-autopay`: the old path was ambiguous against
`/v1/client/sips/{sipPlanId}/pause` under the OpenAPI path model, and `no-ambiguous-paths` refused it.
Fastify resolves static-before-parametric so nothing was broken at runtime, but a path that only
works because of a framework's matching order is a shape worth fixing while the app is
pre-production.


## Percentages are money, for typographic purposes

D-029 says a monetary figure uses the `money` utility and never `font-mono`. It was written about
rupee amounts, and three screens read it that way and hand-rolled their own numeric styling for
percentages instead: `Dashboard.returnValue`, `Portfolio.percent` and `Portfolio.percentSmall` each
restated `--be-font-numeric` with `font-variant-numeric: tabular-nums lining-nums` and their own
letter-spacing.

That is the same decision made three times, and it drifted: the three had three different tracking
values for the same kind of figure.

A return percentage sits beside a rupee amount, is read as part of the same figure, and needs the same
tabular alignment for the same reason. So D-029 is read as covering any financial figure, not only
currency, and the three rules now compose `MONEY_BASE + MONEY_SIZE[…] + MONEY_TONE.default` from
`ui/recipes/text.ts`. The practical consequence is that there is now one place to change if the
numeric font stack ever moves, and one place a reviewer has to check to confirm nothing has fallen
back to `font-mono`.

## A shared recipe is a shared write, and parallel batches collide

The sixteen CSS-module conversions were split into four parallel batches on disjoint feature
directories, which is safe for the feature files and is not safe for `src/ui/recipes/`. Two batches
independently decided that "a `Link` wrapping a whole card" deserved a shared constant and both added
`CARD_LINK` to `surface.ts`, with different bodies — one included `h-full`, one did not. TypeScript
caught it as a redeclaration rather than either silently winning.

Resolved by keeping the narrower shared definition, `block text-inherit no-underline`, and expressing
the one call site that needs the anchor to fill its grid cell as `FUND_CARD_LINK` in
`dashboard.recipe.ts`. The general constant stays general; the exception is local and named.

The transferable point: when work is parallelised by directory, the shared vocabulary layer is the
contention point, and a batch that adds to it must re-read it before reporting done rather than
trusting the state it read at the start.


## A value-identical constant under a different name is a collision the compiler will not catch

The parallel-batch note above records `CARD_LINK` being added twice with different bodies, caught as a
TypeScript redeclaration. The profile/statements/notifications/support/device-security/legal batch hit
the same contention four times, and only one of the four was a redeclaration.

`ACTION_ROW` collided by name and failed the build. `ENTRY_LINK` vs `CARD_LINK`, `PROSE_RELAXED` vs
`HONESTY_TEXT`, and `STACK_MD` vs `CARD_STACK` were byte-identical class strings under different
names, in different files, added within minutes of each other. Every gate passed: typecheck, lint,
tests, build, and the emitted CSS was correct because Tailwind deduplicates the utilities anyway.
Nothing failed. The vocabulary simply grew two names for one thing, which is the exact defect this
migration exists to remove.

Found by diffing every `export const NAME = "…"` body across `src/ui/recipes/` and reporting bodies
that appear more than once:

```
grep -rnE '^export const [A-Z_0-9]+ = "' src/ui/recipes/*.ts \
  | sed -E 's/^([^:]+):[0-9]+:export const ([A-Z_0-9]+) = (".*")$/\3\t\2\t\1/' | sort
```

Run against the whole recipe layer it also surfaces long-standing pairs that are **not** defects —
`RADIO_TEXT`/`SWITCH_TEXT`, `SECTION_HEAD`/`STAT_ROOT`, `AMOUNT_INVALID`/`TEXTAREA_INVALID`. Those are
distinct concepts that currently need the same utilities, and merging them would couple unrelated
components through a shared name. So the check does not produce a rule; it produces a list a human has
to judge. The judgement is: same concept, one name; different concepts, separate names even when the
strings match today.

`ROW_BETWEEN_BASELINE` was added in full knowledge that it duplicates `SECTION_HEAD_ROW`, for that
reason.


## A console-wide stylesheet belongs in `ui/recipes/`, not in one of the features that reads it

The convention established by the other conversion slices is that feature-local vocabulary goes in
`features/<feature>/<feature>.recipe.ts`. `admin/shared/Admin.module.css` did not fit it. Thirteen
sibling admin domains plus `admin/shared/` read that one file, so there is no `<feature>` to put it
under: whichever one was chosen, the other thirteen would have had to import across a sibling feature
boundary to get a filter chip or a table cell.

Decided: a stylesheet whose consumers span an entire console is shared vocabulary, and shared
vocabulary lives in `src/ui/recipes/`. It is now `ui/recipes/admin.ts`, sitting next to
`shellAdmin.ts`, which already owns the admin chrome for the same reason.

The test to apply next time is not "is this one feature's CSS" but "can one feature own this without
the others reaching sideways for it". If the answer is no, it is a `ui/recipes/` file.

## The shared recipe layer must be re-read at the end of a parallel slice, not only at the start

An earlier entry recorded two slices colliding on `CARD_LINK` and TypeScript catching it as a
redeclaration. The admin slice hit the quieter half of the same problem: not a name clash, but silent
duplication. It began by reading `ui/recipes/` and correctly concluded that a card-wide link, a gap-4
column, a wrapping button row, a baseline-spread row, a 16px semibold item title, a gap-0.5 stack, a
small prose paragraph, a faint 12px caption and a mono reference style had no shared home yet, so it
created nine admin-prefixed constants for them.

By the time the slice finished, all nine existed in the shared layer, added by the three sibling
slices while it was running: `ACTION_ROW`, `STACK_LG`, `ROW_BETWEEN_BASELINE` in `layout.ts`,
`CARD_LINK` in `surface.ts`, `ITEM_TITLE`, `ENTRY_TEXT`, `PROSE_SM` in `datalist.ts`, `META_TEXT` and
`REFERENCE_TEXT` in `text.ts`. Nothing failed. Two vocabularies for the same nine patterns would
simply have shipped, and the admin-prefixed half would have looked deliberate.

Resolved by deleting all nine and re-pointing roughly sixty call sites at the shared constants. Three
of the substitutions are close rather than exact and are logged as such: `PROSE_SM` is 64ch and
`leading-normal` where `.note` was 68ch and `leading-relaxed`; `META_TEXT` adds an explicit
`leading-normal`; `REFERENCE_TEXT` adds `tracking-[0.06em]` to what was a plain mono slug.

One duplicate was left standing on purpose. `STATE_REFERENCE` in `state.ts` is string-identical to
what `ADMIN_CODE` needs, and folding both into a single shared constant means editing `state.ts`,
which belongs to another slice's working tree in this round. Consolidating it now would trade a
harmless duplicate for a live write conflict. It is recorded as a follow-up instead.

The rule this produces: in a directory-parallelised change, the shared layer is not a fixed input. A
slice that touches it must diff it again before reporting done, and must check for equal *values*, not
only equal names — a name clash is caught by the compiler, a duplicated utility string is not.

## `.mono` meant the opposite of monospace, and it was carrying money

D-029 says a monetary figure uses the `money` utility and never `font-mono`. The admin stylesheet had
a class named `.mono` whose body was `--be-font-numeric` with `font-variant-numeric: tabular-nums
lining-nums` — the money treatment, under a name that states the opposite — and it was the class on
the rupee amounts in the mandate list and mandate detail screens. A reviewer grepping for `mono` to
audit D-029 would have found the compliant code and flagged it, and a developer reaching for a
monospace identifier style would have found this and used it.

Renamed on conversion: money-shaped figures are `ADMIN_FIGURE`, which composes `MONEY_BASE`, and the
genuinely monospace class is `ADMIN_CODE`, which composes `REFERENCE_TEXT`. All 22 `ADMIN_CODE` call
sites were read individually to confirm each is an identifier, hash, slug or request id, and none is
an amount.

The transferable point is that D-029 cannot be audited by grepping for `font-mono` alone. A class name
can lie in either direction, and the check that actually holds is reading what each call site renders.


### D-033
**Tailwind v4 replaces CSS Modules, with the token layer as its theme source.** · DECIDED 2026-08-29

Doc 07 rejected Tailwind on four grounds. The maintainer directed the change anyway, so each ground
had to be either satisfied or shown to be spent:

1. *The APK has a hard 160 kB CSS budget.* Already superseded by D-028, which raised the ceiling to
   640 kB deliberately to fund a high-end visual layer. The migrated CSS is 84 kB.
2. *The token contract is test-enforced, and `tokens-core.css` is the sole legal owner of
   `env(safe-area-inset-*)`.* **This was the load-bearing objection and it is preserved.** The bridge
   is `@theme inline`, which compiles every utility to `var(--be-*)` rather than copying the value.
   `tokens-core.css` remains the only file that reads `env()`, and safe area is consumed exclusively
   through named spacing keys (`pt-safe-top`, `pb-safe-bottom`) that resolve to `var(--be-safe-*)`.
   `safeArea.test.ts` passes unchanged.
3. *Locally-scoped class names structurally prevent the legacy four-vocabulary collision
   (`be-*`/`apk-*`/`adm-*`/`ash-*`).* Moot: there is no hand-written global vocabulary left to
   collide. The replacement guarantee is `src/ui/recipes/`, a typed layer where each pattern is
   declared once, plus `recipes.test.ts`, which fails if two names share one non-structural class
   string.
4. *Zero new build dependencies.* No longer true: `tailwindcss` and `@tailwindcss/vite`, both pinned
   exact. Accepted as the price of the directive.

Two properties actually improved. Clearing `--breakpoint-*` to exactly the four canonical values
makes a fifth breakpoint unrepresentable rather than merely forbidden — the 640 px media query that
had drifted into `Charts.module.css` cannot recur. And clearing `--color-*` means an off-brand colour
cannot be named at all.

Rejected: keeping CSS Modules and layering Tailwind on top. Two styling systems is the condition this
migration exists to remove, and a per-component stylesheet beside a utility class is exactly how the
legacy frontend reached four vocabularies.

### D-034
**The launch/window colour is `#F4F1E9`, not `#F7F7F5`, and it is enforced by a test.** · DECIDED 2026-08-29

Doc 08 required one colour in four places, byte-identical, to stop a flash during the
native-splash → WebView → React handoff. The pinned colour was `#F7F7F5` (`--be-ivory`). But every
screen that actually renders — `AuthLayout` and both app shells — paints `--be-parchment-2`
(`#F4F1E9`). So the contract held the launch surfaces consistent with each other while all of them
disagreed with the running app.

That produced two visible defects. A launch flash, which is what the contract was written to prevent.
And on Android a coloured seam: where the WebView is inset by the system bars, those strips are
painted with the window background, so a 132 px band of `#F7F7F5` sat above a `#F4F1E9` page. Measured
before and after on device, the strip-to-page delta fell from (7,12,19) to (4,6,7); the remainder is
the mesh radial gradient, which a solid native bar cannot reproduce.

`--be-bg` now aliases `--be-parchment-2`, and the shells consume `bg-bg` rather than
`bg-parchment-2`, so the token is the single answer to "what colour is this app". The contract grew to
five places — it had silently omitted `DEFAULT_BAR_BACKGROUND`, the value actually handed to the
native bars — and `launchColour.test.ts` now follows the `var()` alias into the palette and checks all
five. The prose comment in `colors.xml` that used to carry this knowledge is deleted: it was
redundant once the test existed, and writing `--be-bg` into it broke the build, because `--` is
illegal inside an XML comment.

### D-035
**Both variants ship the same stylesheet, and that is accepted.** · DECIDED 2026-08-29

Under CSS Modules the two build targets emitted different stylesheets, because Rollup tree-shook by
module graph. Tailwind scans the filesystem, so each variant now receives the union of every utility
used anywhere and the two CSS files are byte-identical.

Checked before accepting. No admin *screen* reaches the client bundle: searched the built client APK
for user-visible admin strings and `Audit log` and `AUM` are absent, while `Good to see you`,
`See portfolio`, `Manage SIPs` and `Value ledger` are absent from admin. Component identifiers are
useless for this check because the bundle is minified and they are mangled. The `/admin/` strings that
do appear are `@beonedge/contracts` operation descriptors, pre-existing under D-020, and the single
`phonepe` match is a Zod enum literal (`provider: "phonepe"`, `phonepe_autopay`), not the native SDK,
which is why `check-phonepe-native-target` passes.

What leaks is therefore dead utility classes with semantically neutral names, at 84 kB against a
640 kB budget.

Rejected: variant-specific CSS entries using `@source not` plus a Vite alias. It would reintroduce a
variant-dependent build path to save bytes nobody is short of — the divergence risk this work exists
to remove.

Worth recording separately: `check-android-dist.mjs` matches `CROSS_TARGET_PATTERNS` against
`asset.name` only, never against contents. It has never verified cross-target leakage, and the
argument above rests on the manual APK inspection, not on that gate.



### D-036
**One pending-recovery record with a `kind`, not two keys.** · DECIDED 2026-08-29

Doc 07 §state classification sketches two localStorage keys, `boe.pendingPayment` and
`boe.pendingAutoPaySetup`. The implementation has one, `beonedge.pending-payment.v1`, with one set of
helpers and one reader (`PendingPaymentRecovery`). Closing the mandate-stranding defect needed a
mandate record; it did not need a second store.

`PendingPayment` is therefore a discriminated union on `kind` — `"order_payment"` as before,
`"mandate_setup"` adding `sipPlanId` — persisted under the existing key through the existing
`persistPendingPayment`, which already writes and then reads back to verify. One key means one banner and
one thing to reason about, and the write-verify guarantee is inherited rather than re-implemented.

Accepted consequences, both bounded by the 30-minute TTL:

- A mandate setup started while a lump-sum payment is pending overwrites it, and vice versa. Only the
  banner is lost; the payment itself is unaffected and remains in Activity.
- `PaymentStatusScreen` clears the record when *its* payment settles, so it can clear a mandate record
  belonging to a different flow.

Rejected: a second key. It would duplicate the helpers and the reader to remove a banner collision no
user has hit, and doc 07's sketch carries no authority over the shape once the helper exists.

Also decided: `mandate_setup` recovers to `/sips/{sipPlanId}`, not to `/activity/payments/{paymentId}`.
The payment row does exist — the backend creates a `sip_installment` order and payment during setup — but
the payment screen's terminal affordances are wrong for a mandate: `payment_failed` there offers "Try
again" into the lump-sum flow, while the correct action is "Authorise the mandate again" on the plan,
which is also where the authoritative mandate state is shown.


### D-037
**~~Bearer secrets are persisted on native only, never in a browser.~~ REVERTED same day — see the correction at the end of this entry.** · DECIDED then REVERTED 2026-08-29

`createClientRuntime` set `persistSecrets: true` unconditionally. On Android that is the intended
behaviour, because the persistence port is Capacitor Secure Storage. The same constructor runs in a
browser for the deployed client web build (`Dockerfile` defaults `VITE_BEO_APP_TARGET=client`), where
the port is `createWebPersistence` — so `boe.client.accessToken` and `boe.client.refreshToken` were
written to `localStorage`, readable by any injected script. `createAdminRuntime` already had this
right with `persistSecrets: false`.

`persistSecrets` is now `isNative()`, and `purgeLegacyLocalSecrets()` runs on both platforms rather
than only native, so a browser that already holds leaked secrets from an earlier build is cleaned on
the next load.

Doc 07 line 547 already stated the rule this restores: Secure Storage on native, HttpOnly cookie on
web, never `localStorage`. The client web build has no cookie session — `nativeLogin` returns bearer
tokens — so on web the tokens now live in memory for the lifetime of the document and nothing more.

**Correction — reverted the same day.** The reasoning above is sound and the exposure is real, but the
change broke a shipped surface and was reverted to `persistSecrets: true` with
`purgeLegacyLocalSecrets()` back inside the `native` guard.

Why: the last sentence above — "the tokens now live in memory for the lifetime of the document" — is
precisely the problem. A browser SPA loses that memory on **every full document load**, not merely on
an explicit refresh. `export.sh` builds and ships a client web image, and `frontend-ts-smoke.mjs`
navigates with `page.goto` throughout, so the session died on nearly every screen: the suite fell from
71/71 to 44/49, failing on device security, statements, notifications and the fund catalogue. The
purge made it worse rather than safer, because `purgeLegacyLocalSecrets` clears the *current* keys, so
running it unconditionally wiped the tokens on each web start.

`localStorage` was not a mistake to be corrected in the frontend; it is the only place a bearer session
can survive a document load. Removing it without first providing the replacement mechanism traded a
working product for a partial mitigation.

The exposure stands as an open gap. Closing it properly needs an HttpOnly cookie refresh for the
**client** scope, mirroring what `web-auth` already does for admin — a backend change, since
`nativeLogin` returns bearer tokens by design. Until then the browser client keeps refresh tokens in
`localStorage`, and `src/shells/client/clientRuntime.test.ts` pins that behaviour under a name that
says so, so nobody can "fix" it again without noticing the cookie work is the prerequisite.

What was kept from this decision: the native guarantee is now tested — secrets go to Secure Storage,
never `localStorage`, and any localStorage secrets are purged on native start. That was risk R7's
mitigation with no guard at all before today.

**Accepted consequence.** The client web build no longer survives a reload. `principal` is still
persisted (it is not a secret and admin persists it too), but `restore()` needs an access or refresh
token, and after a reload it has neither, so the session resolves to `anonymous` and the user signs in
again. Native is unaffected: Secure Storage still holds both tokens across process death. The
alternative — a cookie-based refresh for the client scope on web, matching `webRefresh` — is a backend
change (`web-auth` currently issues cookies for the admin scope only) and is not attempted here.

Rejected: keeping `localStorage` persistence and relying on a short access-token TTL. A refresh token
in `localStorage` is a full session-takeover primitive regardless of the access token's lifetime.

### D-038
**`emailVerificationState` is the one name for a client's verification state.** · DECIDED 2026-08-29

`GET /v1/client/email-verification-status` returned `emailVerificationStatus`, while the contract
operation `getEmailVerificationStatus` requires `emailVerificationState`. The transport validates
every response against the contract, so the first caller would have taken a malformed-response error.
It was latent only because `useEmailVerificationStatus` has no consumer — `VerificationStatusScreen`
reads `useEligibility()` instead.

The backend was the wrong side: `packages/contracts/src/operations/client.ts`, `db/types.ts`, the
repositories, the eligibility payload and doc 04 line 247 all say `emailVerificationState`. Both
`sendData` calls in `clientEmailVerificationRoutes.ts` were renamed; no contract changed, so no
regeneration was needed and the contracted-operation count is still 94.

The `/verify` response was renamed too even though its contract is `z.looseObject({})` and would have
accepted either name. Leaving one route on `emailVerificationStatus` would have preserved exactly the
inconsistency this closes.

`admin-oversight.ts` deliberately keeps `emailVerificationStatus` in its own contract and matching
route, so admin is internally consistent and was left alone.

Rejected: deleting the hook and the contracted operation as dead. The endpoint is real, documented in
doc 04, and the client verification surface is the natural consumer; removing a contracted operation to
avoid renaming a field on the side that was already wrong is the larger change.

### D-039
**One percentage formatter, at two decimals.** · DECIDED 2026-08-29

`ui/charts/chartMath.ts::formatShare` rendered one decimal while `DashboardScreen` and
`PortfolioScreen` each hand-rolled `toFixed(2)` with their own sign handling. That is the legacy
`formatReturnPct` (2 dp) versus `fmtPct` (1 dp) split that doc 10 and doc 11 exist to prevent,
reintroduced with three copies instead of two.

`domain/percent.ts::formatPercent` is now the only percentage formatter. It takes a percentage number
(`12.34` → `12.34%`), returns the em-dash absent marker for `null` and non-finite input, and mirrors
`formatINR`'s option name and sign rule: `showSign` adds `+` for strictly positive values only. It sits
in `domain/` beside `money.ts` because D-029, as extended by “Percentages are money, for typographic purposes”, already treats a return percentage as a financial figure
for typographic purposes; the same argument applies to its formatting.

Two decimals, not one, because the figure that matters most here is a return percentage read beside a
rupee amount, where a tenth of a percent is meaningful; an allocation share carrying a redundant
decimal is only cosmetic. Precision is a module constant, deliberately not a parameter — an optional
precision argument is how the legacy split happened.

**User-visible changes.** Donut legends and the donut's `aria-label` (fund detail sector allocation,
admin fund holdings) go from `42.3%` to `42.31%`. A return of exactly zero renders `0.00%` instead of
`+0.00%`, matching what `MoneyValue` already does with zero growth in the cell beside it. Negative and
non-zero positive returns are unchanged.

Left alone: `FundHoldingsScreen` renders `weightPercent` raw, because the contract types it as a
decimal *string* (`Decimal24x8`) and routing it through a `number` formatter would reintroduce the
float conversion the string type exists to avoid. `DonutChart`'s `legendUnit` prop remains, still
unused by any caller.
