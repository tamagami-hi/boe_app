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
**~~Bearer secrets are persisted on native only, never in a browser.~~ REVERTED same day, then
restored on 2026-08-30 once the replacement existed — see the two corrections at the end of this
entry and D-052.** · DECIDED then REVERTED 2026-08-29, REINSTATED 2026-08-30

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

~~The exposure stands as an open gap.~~ Closing it properly needs an HttpOnly cookie refresh for the
**client** scope, mirroring what `web-auth` already does for admin — a backend change, since
`nativeLogin` returns bearer tokens by design. Until then the browser client keeps refresh tokens in
`localStorage`, and `src/shells/client/clientRuntime.test.ts` pins that behaviour under a name that
says so, so nobody can "fix" it again without noticing the cookie work is the prerequisite.

**Second correction — the gap is closed, in the order this entry insisted on.** · 2026-08-30

The prerequisite named in the paragraph above was built first: `/v1/auth/client/web/{login,refresh,csrf,logout}`,
a `client_web` session channel, and a cookie transport inside `createClientRuntime`. Only then were
`persistSecrets: isNative()` and the unconditional `purgeLegacyLocalSecrets()` reapplied — and this
time they cost nothing, because a browser document no longer has to remember anything to stay signed
in. **D-052** records what was built and what bounds it. The pinning test is gone, replaced by
assertions of the new guarantee.

What this entry should be read for, permanently: a mitigation that removes a capability is not a
mitigation. The first half was right about the exposure and wrong about the order, and the order was
the entire difference between 71/71 and 44/49.

What was kept from this decision: the native guarantee is now tested — secrets go to Secure Storage,
never `localStorage`, and any localStorage secrets are purged on native start. That was risk R7's
mitigation with no guard at all before today.

**~~Accepted consequence.~~ Superseded by D-052.** The client web build no longer survives a reload.
`principal` is still persisted (it is not a secret and admin persists it too), but `restore()` needs an
access or refresh token, and after a reload it has neither, so the session resolves to `anonymous` and
the user signs in again. Native is unaffected: Secure Storage still holds both tokens across process
death. The alternative — a cookie-based refresh for the client scope on web, matching `webRefresh` — is
a backend change (`web-auth` currently issues cookies for the admin scope only) and is not attempted
here. *That alternative is what D-052 implements. The browser build now survives a document load on
its cookies, and `restore()` no longer consults stored credentials at all: it re-establishes the
session from the cookie session itself.*

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


### D-040
**The Capacitor bridge is registered explicitly, for three named plugins, from `main.tsx`.** · DECIDED 2026-08-30

`window.Capacitor.Plugins` is written by exactly one function — `registerPlugin` in
`@capacitor/core` — and nothing in `src/` had ever called it or imported a plugin package. The
Android `native-bridge.js` does not populate `Plugins` from `PluginHeaders`; it only reads it. So
every wrapper in `src/platform/` resolved to `null` on device and failed silently by design
(`tryCallPlugin` swallows, `lifecycle.subscribe` returns a no-op unsubscribe). Both gaps in Entry
022 are unreachable without fixing this, because `AppUpdatePlugin` has a Java registration and no JS
one, and `@capgo/capacitor-native-biometric` self-registers only when imported.

Three options were considered.

*Import each plugin package for its side effect* (`import "@capacitor/app"` and friends). Rejected:
it pulls each package's web implementation into the bundle, and those web implementations change
behaviour in a browser — `@capacitor/app`'s web shim answers `appStateChange` from
`visibilitychange`, so lifecycle events that have never fired on the web would start firing. It also
cannot register `AppUpdate`, which has no npm package.

*Register everything the allowlists mention.* Rejected: `SecureStoragePlugin` is a name that does not
exist (the package registers `SecureStorage`), so registering it would manufacture a proxy that
always throws and turn a currently-honest `available() === false` into a stream of rejections.

*Register the three names `src/` actually calls, with no web implementation.* Chosen. `App`,
`AppUpdate`, `NativeBiometric`. On the web the proxy exists but every method rejects
`UNIMPLEMENTED`, which every call site already handles — `isNative()` guards the new wrappers, and
`lifecycle.subscribe` already had `.catch(() => undefined)`. `src/platform/plugins.test.ts` asserts
the three become reachable and that a browser subscribe/unsubscribe cycle produces no unhandled
rejection; removing that `.catch` makes `vitest run` exit 1, so the guard is real.

**Consequence that needs a device.** `NativeBackCoordinator` was inert and is now live. Android Back
stops falling through to Capacitor's default (`goBack`, then finish) and starts obeying the five
rules in doc 08. `applySystemChrome` starts issuing real `SystemBars` / `SystemChrome` calls, and
`openDestination` starts using the in-app Browser. None of that has been observed running.

**Not fixed, deliberately:** `secureStorage.ts` asks for `"SecureStoragePlugin"` where the package
and its `@CapacitorPlugin(name = ...)` both say `"SecureStorage"`. Correcting it moves client bearer
tokens from nowhere into the Android keystore, which is an auth-path change that deserves its own
task and a device.
**Reversible:** yes. Deleting the `bridgeNativePlugins()` call restores the previous, inert state.

### D-041
**The lock engages before the session is known, and a forgotten PIN removes the PIN and signs out.** · DECIDED 2026-08-30

Two coupled choices.

*Why the lock does not wait for `status === "authenticated"`.* Gating on session status means the
cold-start decision runs while the status is still `restoring`, so the lock could only appear after
restore resolves — by which time the dashboard has mounted and balances have painted. A lock that
flashes the content it is protecting is not a lock. So enrolment alone decides, and the lock covers
the sign-in screen too.

*Why that needs an escape hatch.* A device PIN is stored only on the device and can never be
recovered or reset by support. Without a way out, forgetting it makes the install unusable — and
because the lock now also covers the signed-out state, "sign out and back in" is not available
either. `LockScreen` therefore offers "I have forgotten this PIN", which removes the PIN *and* calls
`session.signedOut()`.

This does not weaken anything the product claims. The honesty copy already states that the PIN is
"a convenience, not a security boundary" and that "anyone who can read this device's storage can
bypass it"; a documented button is strictly weaker than the bypass already admitted to. And it is
not a free pass: it clears the token store, so the person who takes it gets a sign-in screen, not
an account.

**Rejected:** an attempt counter with a lockout. It cannot escalate to anything — there is no server
involved and no data to wipe — so it would only add delay while still needing this same escape.
**Reversible:** yes, but removing the escape without also narrowing the lock to authenticated
sessions would strand users.

### D-042
**A mandatory update blocks even when there is nothing to download.** · DECIDED 2026-08-30

`GET /v1/app/update` computes `mandatory` and `updateAvailable` from different inputs. `mandatory`
compares the *running* `version` against `minimumSupportedVersion` from the published app config;
`updateAvailable` compares the running `versionCode` against the newest APK on the release mount.
The backend comment is explicit that "you are too old to use this" is a statement about the caller.
So `mandatory: true, latest: null` is reachable — a floor was published before, or without, the
build that satisfies it.

The gate blocks anyway, and says so: "There is no newer build published for this device yet, so
there is nothing to download here", with a Check again button. The alternative — treating an
unsatisfiable floor as non-mandatory — lets a build the operator has declared unsupported keep
talking to the server, which is the situation the floor exists to end.

For the same reason `decideAppUpdate` reads `mandatory` before it looks at whether a release is
installable, and `installableRelease` returns `null` rather than a partial release when the URL is
absent, non-`https`, or the digest is not 64 lowercase hex characters. There is no code path that
reaches `downloadUpdate` without a digest: the decision refuses, the platform wrapper refuses again,
and `AppUpdatePlugin.java` refuses a third time.

**Risk accepted:** a config typo in `minimumSupportedVersion` blocks every client. The backend
already mitigates the worst form — an absent or unparseable floor is never mandatory — but a valid
floor that is simply too high is not distinguishable from a deliberate one.
**Reversible:** yes, one branch in `decideAppUpdate`.


### D-043
**Which lists page, which walk every page, and which stay one-shot.** · DECIDED 2026-08-30

Cursor pagination is not free correctness. A list that pages is a list whose consumer must be able to
cope with holding a prefix of it. Three categories, decided per consumer rather than per endpoint:

**Paged with a Load more** — the browsable queues and histories. Client: transactions, payments,
notifications, support requests, orders. Admin: applications, users, per-user login events, audit log,
email deliveries, fund receipts, refunds, payments, mandates, funds, AUM history, FAQs. These are read
newest-first, the user is looking for something near the top, and the shared `LoadMore` states how many
rows are in hand so a prefix is never mistaken for the whole.

**Paged but walked to the end (`loadAll: true`)** — lists whose consumer needs the complete set to be
correct at all:

- The fund catalogue behind a `<select>`: `IndividualClientGrowthScreen`,
  `CollectiveClientGrowthScreen`, `CollectiveAumGrowthScreen`. A fund missing from the options is a
  fund an administrator cannot act on, and there is no error to see.
- The fund catalogue used as an id→name lookup: `PortfolioScreen`, `SipListScreen`,
  `SipDetailScreen`, `ActivityScreen`. A truncated catalogue renders a real holding as "Fund".
- `frontend_stack_ts/src/features/funds/FundListScreen.tsx`, which searches and sorts client-side.
  `GET /v1/client/funds` has no search parameter, so paging it would turn "search the catalogue" into
  "search the first 25", which is the exact defect doc 04's BC9 describes. Either the search moves to
  the server or the client holds the whole catalogue; the catalogue is administrator-managed and small,
  so it holds it, over the cursor, one page at a time.

This is expressed as `loadAll` on `usePagedQuery` rather than as a separate unpaged request, so these
consumers still travel the cursor and cannot silently exceed `MAX_PAGE_LIMIT`. `useFundCatalogue` and
`useAdminFundCatalogue` share a query key with their paged siblings, so the cache is shared.

**Deliberately one-shot, with the reason:**

- `GET /v1/client/statements` — derived per read by folding the entire ledger in
  `deriveStatements`; the response is one row per month of the account's life. Bounded by account age,
  and a cursor over a derived projection would have to be a cursor over the ledger it came from.
- `GET /v1/client/support/faqs`, `GET /v1/client/research-context`,
  `GET /v1/public/*` content — published editorial documents, bounded by what an administrator wrote.
- `GET /v1/admin/funds/:fundId/stocks` — the disclosed holdings of one fund version, a bounded
  editorial set displayed as a whole.
- `POST /v1/admin/client-growth/collective/preview` and its commit — not a browsable list. The
  preview's `basisHash` covers the entire target set and the commit is refused if the basis moved, so a
  paged preview would be a preview of something that cannot be committed. Capped at 500 by the
  contract. The scope note asked for "admin client positions"; there is no client-positions *list*
  endpoint, only this preview.
- The admin Overview queue tiles read the first page only, and render `25+` when `hasMore`. There is
  no count endpoint in the API; reporting `items.length` would print the page size as the queue depth,
  which is worse than an approximation that admits it is one.

**Risk accepted:** the `loadAll` consumers issue one request per 25 funds on mount. If the catalogue
ever reaches hundreds, those screens want server-side search instead, not a bigger page.
**Reversible:** yes, per call site — the two variants differ by one flag.

### D-044
**`AdminPageMeta` and `PageMeta` stay as two schemas for one wire shape.** · DECIDED 2026-08-30

`packages/contracts/src/envelope.ts` exports `PageMeta` (with `nextCursor: Cursor.nullable()`, bounded
`limit`) plus `PAGINATED_METADATA_SHAPE` and `createPaginatedSuccessEnvelopeSchema`.
`operations/admin-shared.ts` separately exports `AdminPageMeta` with `nextCursor: z.string().nullable()`
and an unbounded `limit`, and `operations/admin-fund-aum.ts` declares a third private copy.

Client operations here use `createPaginatedSuccessEnvelopeSchema`; the seven admin operations that
gained a page in this entry use `AdminPageMeta`, matching their ten siblings. Unifying would be right
and is one mechanical rename, but it changes the validation of ten already-shipping admin responses at
the same time as introducing pagination to three new ones, and the two changes would be
indistinguishable if an admin screen broke.

**Risk accepted:** admin `nextCursor` values are not shape-checked against the `Cursor` scalar, so a
malformed admin cursor is detected by the backend's `decodeCursor` on the next request rather than by
the client on arrival. Fails closed either way — `CURSOR_INVALID`.
**Reversible:** yes, and it should be reversed in its own change.

### D-045
**`unreadCount` counts the account, not the page.** · DECIDED 2026-08-30

`GET /v1/client/notifications` used to derive `unreadCount` from the rows it was about to return.
Once the route pages, that reads "unread among the 25 you asked for", and the inbox badge would shrink
as the user pages *forward*. It is now `select count(*) from notifications where user_id = $1 and
read_at is null` in the same transaction as the page read.

The screen's copy changed with it: `N unread of M` became `N unread on this account`, because `M` was
the length of the loaded prefix and no longer means anything to a reader.

**Risk accepted:** one extra query per inbox read. It is an indexed count on a per-user partition of a
small table.
**Reversible:** yes.


### D-046
**`optionalIdempotencyKey` stays; doc 10's "unused" row is wrong.** · DECIDED 2026-08-30

Doc 10's Phase 13 "safe to remove — proven dead" table lists `optionalIdempotencyKey` as unused. It
is not. Three admin write paths call it: `routes/adminOversightRoutes.ts:148`,
`routes/adminContentRoutes.ts:224` and `routes/adminCatalogRoutes.ts:151`. It exists as a distinct
helper from `requireIdempotencyKey` on purpose — those three routes accept a key and honour it if
present, but do not make it mandatory, whereas the financial writes reject the request without one.

**Risk accepted:** none from keeping it. The risk was in the doc: the row is phrased as proven, and
acting on it deletes three working endpoints' idempotency handling. Recorded here because doc 10 is
the instruction the next agent will read.
**Reversible:** n/a — nothing changed.

### D-047
**`mandateReconciliationWorker` stays co-hosted in the payment-reconciliation pass. No separate
entrypoint, no compose service.** · DECIDED 2026-08-30

Doc 10 asks to "wire it or remove it", and doc 01 records that only four worker containers run on
dev. Both are accurate about the deployment topology and both leave the impression that mandate
reconciliation does not execute. It does. `runMandateReconciliationPass` is called from
`composePaymentReconciliationWorker`'s `runOnce` (`runtime/composition.ts:698`), guarded by
`recurringGateway !== null`, immediately after the payment pass and inside the same worker process —
so `npm run worker:payments` (`src/paymentReconciliationEntrypoint.ts`, the `boe-*-payments-worker`
container) runs both, and records one `payment_reconciliation` heartbeat covering both.

Removing it would remove mandate convergence with PhonePe outright. Giving it its own entrypoint and
compose service would mean two processes on overlapping mandate row locks, a second heartbeat name,
a `verify.sh` expectation change and a VPS deployment — none of which is cleanup, and all of which
needs the maintainer.

**Risk accepted:** the mandate pass has no independent observability. A mandate reconciliation that
throws fails the whole `payment_reconciliation` pass and is attributed to payments in the heartbeat
and the logs; a mandate pass that silently converges nothing is invisible, because the summary
returned to the entrypoint is the *payment* summary and the mandate pass's result is discarded. That
is the real defect behind doc 10's complaint, and it is an observability fix (a distinct heartbeat, or
a merged summary), not a topology one.
**Reversible:** yes — splitting it out later is additive.

### D-048
**The refund machinery stays whole, including `refundRepository.create`, which still has no
caller.** · DECIDED 2026-08-30

Doc 10's factual claim holds: nothing in production creates a `refund_operations` row. Only
`test/integration/paymentSettlement.integration.test.ts` calls `create`. Every other part of the
feature is live and shipped:

- `routes/adminFundReceiptRoutes.ts` serves the refund list (`listPage`, :255), the admin requeue
  (`requeue`, :315) and reconcile-now (`lockById` + `markRefunded`/`markFailed`/`markStatusChecked`).
- `paymentReconciliationWorker.ts` claims open refunds (`lockDueRefunds`, :332) and drives the state
  machine through `markProviderPending`/`markRefunded`/`markFailed`.
- `domain/payments/applyRefundOutcome.ts` applies PhonePe refund callbacks by `merchantRefundId`.
- `frontend_stack_ts/src/features/admin/refunds/RefundQueueScreen.tsx` is a shipped admin screen
  reading it through `useAdminRefunds`, gated on `refunds.write`.

So the choice is not "dead machinery or not". It is: is refunding a product feature? If yes, the
missing piece is a creation path — an admin-initiated refund route — and deleting the rest would be
throwing away the nine-tenths that exist. If no, the removal spans a repository, a worker branch, a
domain module, three admin endpoints, a screen, a permission and a table with a restrictive FK. That
is doc 10's **D6**, unanswered, and it is a product decision.

**Risk accepted:** the admin Refunds screen can only ever show an empty list in production, and an
operator may reasonably read that as "no refunds have failed" rather than "no refund can exist". The
screen's own copy does not say which. Anyone answering D6 with "yes" should add the creation path
before anyone relies on that screen.
**Reversible:** n/a — nothing changed.

### D-049
**`adminFundGrowthPreviewRoutes.ts` stays. If the one-route split is offensive, change the scanner,
not the route.** · DECIDED 2026-08-30

The module exists only because `investment-architecture.guard.test.ts`'s §4.1 dependency wall
classifies any module whose *path* contains `aum` and then greps its *source* for `review` — and the
mandated route literal `/v1/admin/aum/growth/collective/preview` contains `review` inside `preview`.
The module's own header says so. That is a scanner defect, not an architecture one.

It is also a live endpoint: registered at `runtime/composition.ts:463`, covered by
`test/integration/adminAum.integration.test.ts:189`, and called by
`features/admin/fund-aum/CollectiveAumGrowthScreen.tsx:52` via `previewAdminCollectiveAumGrowth`.
Deleting it removes the preview half of the preview-then-commit protocol, which is the only thing
that produces the `basisHash` the commit endpoint requires — the commit would become uncallable.

The right fix is one word in the guard: match `\breview\b` rather than the bare substring, then fold
the handler back into `adminAumRoutes.ts`. Not done here because loosening a dependency-wall guard
and moving a financial write handler in the same change as a deletion pass is how a wall quietly
stops holding.

**Risk accepted:** a one-route module and a misleading guard both persist. The guard still catches
real `review` references in AUM modules, so the wall is intact; it is only over-strict.
**Reversible:** n/a — nothing changed.

### D-050
**The provider-event inbox drain was removed entirely — all three methods — while its schema support
was kept.** · DECIDED 2026-08-30

The instruction named `providerEventInboxRepository.claimReceived` alone. Removing only that would
have left `.reschedule` (documented `processing -> received`) and `.deadLetter` in the interface with
no caller *and* no reachable precondition: `claimReceived` was the sole writer of
`state = 'processing'`, so after its removal neither method could ever apply to a row. All three had
zero consumers in `src/`, `test/`, `scripts/` and the workers. They were removed as one unit.

What was **not** touched: the `provider_events` columns the drain used (`locked_at`, `locked_by`,
`attempt_count`, `available_at`, `last_error_code`) and its `processing` / `dead_lettered` state
values. No migration was written. `markProcessed` still nulls `locked_at`/`locked_by`, which is
harmless and stays correct if a drain returns.

**Risk accepted:** the honest consequence, now written into the module header instead of implied by a
lease method nobody called — a PhonePe callback whose synchronous processing fails inside
`phonePeProviderEventRoutes` / `phonePeMandateEventRoutes` is **not** retried by anything in this
repository. Recovery depends on PhonePe redelivering, or on the reconciliation pass polling provider
state and reaching the same conclusion by another route. Deleting the methods did not create that gap;
it stopped the code from pretending the gap was covered.
**Reversible:** yes, and the schema is still shaped for it.

### D-051
**`user_credentials.locked_until` was dropped from the Kysely type only. The columns stay, and its
two dead siblings stay in the type.** · DECIDED 2026-08-30

`locked_until` had no reader or writer and is gone from `UserCredentialsTable` in `db/types.ts`.
`failed_attempt_count` and `failed_attempt_window_started_at` are equally dead in code and were
**left in the type**, which is deliberately inconsistent and needs stating plainly:

- The instruction named only `locked_until`.
- Doc 10 puts the whole group in its "requires a decision, not a deletion" table, and migration
  `026_login_events.sql:38-41` calls the absence of lockout a deliberate deferral, not an oversight —
  the migration exists to make lockout *decidable* by recording attempt history.
- `failed_attempt_count` and `failed_attempt_window_started_at` are coupled by a CHECK
  (`user_credentials_window`), so they are one unit and dropping them is one reviewed migration.

**Risk accepted:** `db/types.ts` now under-describes `user_credentials` by one column, and there is no
schema-drift test in the repository that would notice — nothing compares `db/types.ts` to
`db/migrations/**`. A future `selectAll()` on that table returns a column TypeScript does not know
about. Low: the column is never read, and adding it back is one line.
**Reversible:** yes, trivially.


### D-052
**The browser client gets its own cookie session on a third session channel, `client_web`. One
implementation of the cookie machinery, two scope descriptors.** · DECIDED 2026-08-30

This is the prerequisite D-037 named, built before the `localStorage` removal it enables. Four
endpoints, contracted and generated (94 → **98** operations, 84 → 88 paths):

```
POST /v1/auth/client/web/login     ClientWebSessionData + Set-Cookie pair
POST /v1/auth/client/web/refresh   rotation, needs the refresh cookie + x-csrf-token
GET  /v1/auth/client/web/csrf      reload recovery, needs neither
POST /v1/auth/client/web/logout    revokes the family, expires the cookies
```

**Reused, not reimplemented.** `domain/auth/webAuth.ts` was made generic over a `WebAuthScope`
instead of being copied. One `webLogin`, one `webRefresh`, one `webRecoverCsrf`, one
`authenticateCookieSession`; the scope supplies the cookie names, the session channel, the audit
command, the audit actor type, the principal builder and the login-eligibility rule.
`ADMIN_WEB_SCOPE` lives beside them, `CLIENT_WEB_SCOPE` in `clientWebAuth.ts`. The reason is the
rotation state machine: the 30-second previous-pair grace, the same-`rotationId` reproduction and the
family revocation on reuse are the parts that are subtle and the parts a copy would drift on. Cookie
names and channels are data; a rotation state machine is not.

**Why a new session channel rather than reusing `web`.** `authenticateWebRequest` admits any active
session whose channel is `web`. Had the client browser session also been `web`, a client cookie would
have satisfied the admin console's *authentication* step and been stopped only by the permission
check behind it. Authorization is the wrong layer to keep two audiences apart — permissions are
per-user, and a user can hold both. With `client_web` the separation is the same predicate that
already separates native from web, and it is enforced four times over:

1. **Cookie names differ** — `boe_client_access`/`boe_client_refresh` versus
   `boe_access`/`boe_refresh` (each `__Host-` prefixed when `WEB_COOKIE_SECURE`). Neither path reads
   the other's name, both sessions coexist in one browser, and signing out of one leaves the other
   alone because `expireAuthCookies` clears only its own scope's four names.
2. **Channel is required exactly** — `authenticateCookieSession` compares `session.channel` with the
   transport's own, so an admin access-cookie *value* replayed under the client cookie name resolves
   to a `web` session and is refused, and vice versa. `authenticateNativeRequest` still requires
   `native`, so neither cookie works as a bearer token either.
3. **Rotation is channel-scoped** — `webRefresh` refuses a refresh cookie whose session channel is not
   the scope's, and `rotateWebCsrf` carries the channel in its `WHERE`, so one audience's reload
   recovery cannot rotate the other's synchronizer token.
4. **CSRF material is per session row**, and the two audiences never share a row.

**The rejected alternative** was a `scope` column or a claim inside the access token. Both put the
discriminator somewhere the existing `channel` predicate does not look, which means every
authentication path would have had to learn a second check, and the one that forgot would be the
vulnerability. The channel is already the thing every path checks.

**Migration `046_client_web_sessions.sql`** adds the enum value and restates
`auth_sessions_web_csrf_present` as "every non-native channel carries a CSRF pair", expressed against
`native` so the file never names the new label — `ALTER TYPE ... ADD VALUE` may run in a transaction
on PostgreSQL 12+, but the value cannot be *used* until that transaction commits, and the migration
runner wraps each file in one. **This migration must be applied before the code that writes
`client_web` runs.**

**CSRF is derived from the HTTP method, not declared per route.** `resolveClientPrincipal` requires
the synchronizer token for everything except GET/HEAD/OPTIONS. Around thirty client route handlers
call it; thirty hand-written booleans is a defect waiting for a careless copy-paste, and the method is
the property the requirement actually follows. The admin surface keeps its explicit per-route flag,
because there it is one flag per `adminRouteKit` registration rather than per handler.

**Transport selection is the presence of the client access cookie**, inverted relative to
`resolveAdminPrincipal`. Admin prefers the cookie and falls back to bearer only when there is no
cookie *and* there is a bearer header; the client prefers the cookie and falls back to the bearer path
**unconditionally**. That is deliberate: with no credential at all the client must fail
AUTHENTICATION_REQUIRED, which is the only code the transport retries after a refresh. Had the
no-credential case fallen into the cookie path it would have failed CSRF_INVALID (403) whenever the
Origin check ran first, and both clients would have signed the user out instead of refreshing —
including the APK, whose access token expires ten minutes into every session.

**Refresh recovers the CSRF token before rotating.** `executeCookieRefresh` calls
`getClientWebCsrf` and then `clientWebRefresh` with the token it just received. A stale synchronizer
token presented to the rotation is indistinguishable from refresh reuse and **revokes the session
family**, and an in-memory token can be one rotation behind through nobody's fault — a second tab
rotated first, or the document has not restored yet. Recovering first costs one GET per ten minutes
and makes multi-tab refresh safe. Two tabs now rotate in sequence instead of the second one
destroying the session.

The same fix was applied to `adminRuntime`, where it repairs an outright defect rather than hardening
a new path: `webRefresh` was called with `unauthenticated: true`, which is exactly the flag that
suppresses the automatic `x-csrf-token` header, so **every admin refresh was answered CSRF_INVALID**
and the console signed the operator out ten minutes in rather than rotating. Nothing caught it because
`frontend-ts-smoke.mjs` finishes well inside the access cookie's ten-minute TTL. Found while mirroring
the path, not while looking for it.

**Accepted consequences.**

- **A stale CSRF token still fails a write with CSRF_INVALID (403).** Only the refresh path was made
  self-healing. A second tab that writes without having refreshed presents the token the first tab
  invalidated and is refused; the user sees an error and a retry succeeds, because the retry runs
  after that tab's own recovery. Fixing this properly means accepting the previous CSRF within the
  grace window on non-rotating requests, which is the mixed-pair refinement `webAuth.ts` has always
  had marked as deferred, and it is not made worse here.
- **The browser client is authenticated by an ambient credential for the first time**, so it now
  depends on the Origin/Referer allowlist the admin console depends on. The client's own origin has to
  be in `WEB_ORIGIN_ALLOWLIST`, and it already is in every committed example — `http://localhost:5174`
  locally (enforced by `originExamples.test.ts`), `https://dev-app.beonedge.in` and
  `https://app.beonedge.in` in the release stacks. A deployment that omits it does not degrade
  quietly: every browser client request fails CSRF_INVALID.
- **Same-origin GET reads rely on the `Referer` fallback**, because browsers do not send `Origin` on
  same-origin GETs. This is not new — every cookie-authenticated admin read already depends on it, and
  the admin half of the smoke suite passing is the evidence that it holds in Chromium. A page that set
  `Referrer-Policy: no-referrer` would break both surfaces at once.
- **The APK is untouched.** `isNative()` picks the bearer path, the native operations are unchanged,
  and Secure Storage still holds both tokens across process death. What changed for native is that the
  three client route files it talks to now resolve the principal through `resolveClientPrincipal`,
  which delegates to the identical `authenticateNativeRequest` when no client cookie is present.
- **`csrfToken` is still persisted to `localStorage`** for both scopes, because `SECRET_FIELDS` holds
  only the two bearer tokens. It is not a session credential: an injected script that can read it can
  equally fetch a fresh one from `/csrf` on the origin it is already running on. Left as admin has it
  rather than diverging the two scopes' storage rules for no gain.

**Reversible:** the frontend half, yes — one boolean. The backend half leaves an enum value behind,
which PostgreSQL cannot drop, so a revert means abandoning the label rather than removing it.



### D-053
**The admin console gets its own bearer session on a fourth session channel, `admin_native`. One
implementation of the bearer machinery, two scope descriptors.** · DECIDED 2026-08-31

The mirror of D-052, in the opposite direction: that entry gave the browser client the cookie
transport the console already had; this gives the console APK the bearer transport the client APK
already had. Three endpoints, contracted and generated (98 → **101** operations, 88 → **91** paths):

```
POST /v1/auth/admin/native/login     AdminNativeSessionData = WebPrincipal + bearer pair
POST /v1/auth/admin/native/refresh   rotation on the admin chain only
POST /v1/auth/admin/native/logout    revokes the family
```

**Reused, not reimplemented.** `domain/auth/nativeAuth.ts` was made generic over a `NativeAuthScope`
instead of being copied. One `nativeLogin`, one `nativeRefresh`, one `authenticateBearerSession`; the
scope supplies the session channel, the audit command, the audit actor type, the principal builder and
the login-eligibility rule. `CLIENT_NATIVE_SCOPE` lives beside them, `ADMIN_NATIVE_SCOPE` in
`adminNativeAuth.ts`. Same reason as D-052: the 30-second previous-token grace, the same-`rotationId`
reproduction and the family revocation on reuse are the subtle parts and the parts a copy would drift
on. Channels and audit labels are data; a rotation state machine is not.

**Why a new session channel rather than reusing `native`.** This is not symmetry for its own sake — it
closes a live hole. `resolveAdminPrincipal` already had a bearer leg, added when the Android admin
target was created, and it called `authenticateNativeRequest`, which admits any active session whose
channel is `native`. That is the *investor* APK's channel, and it is trivially obtainable: any client
with an account can get one from `/v1/auth/native/login`. So an investor's bearer token satisfied the
admin console's **authentication** step, and the only thing between an investor and the console was
`requireAnyPermission`. Authorization is the wrong layer to keep two audiences apart — permissions are
per-user, and a person can hold both an investor account and an operator account. With `admin_native`
the separation is the same predicate that already separates `web` from `client_web`, and it is enforced
four times over:

1. **Credential name or location differs, or the endpoint does.** The two cookie scopes use disjoint
   cookie names. The two bearer scopes both use `Authorization: Bearer`, so for them the discriminator
   is the channel (2) plus a distinct login endpoint that mints a distinct channel.
2. **Channel is required exactly, on all four paths.** `authenticateBearerSession` takes the channel
   from its caller, not from the token; `authenticateNativeRequest` and
   `authenticateAdminNativeRequest` are one-line partial applications of it, so no route can
   accidentally accept "whatever channel the token belongs to". `authenticateCookieSession` compares
   against the transport's own channel as before. The whole 4×4 matrix is asserted in
   `scopeIsolation.test.ts`; only the diagonal resolves.
3. **Rotation is channel-scoped.** `nativeRefresh` now refuses a refresh token whose session channel is
   not the scope's — it did not check at all before, which was the one predicate D-052 claimed for the
   cookie scopes that the bearer scopes did not have. The refusal happens before any write, so a
   mismatched channel is not mistaken for refresh reuse and does not revoke the innocent session's
   family.
4. **No shared session row, and no shared issuance.** A login writes its own channel and nothing
   rewrites it, and `auth_sessions_active_bearer_device_uk` has `channel` in the key. On top of that
   `ADMIN_NATIVE_SCOPE.rejectLogin` refuses an account with no roles, so an investor cannot obtain an
   `admin_native` session at all.

**The rejected alternative** was, again, a scope claim inside the access token — and rejected for the
same reason: it puts the discriminator somewhere the existing `channel` predicate does not look, so
every authentication path has to learn a second check and the one that forgets is the vulnerability.
A second rejected alternative, specific to this change, was widening `/v1/auth/native/login` to return
roles and permissions and letting the admin APK use it. That is the smaller diff and the worse design:
it makes the two audiences' tokens interchangeable in exactly what they authorise, and it would have
kept the hole in (2) wide open by construction.

**The client native login was deliberately not widened.** `CLIENT_NATIVE_SCOPE`'s principal is
unchanged — masked phone, no roles, no permissions. The admin principal is the same `WebPrincipal` the
cookie login returns, so the console renders identically on both hosts and `RequirePermission` works
on device without a second source of truth.

**No CSRF and no Origin check on the three new endpoints.** The credential is a bearer token, which a
hostile page cannot make a browser attach and cannot read from another origin's storage. The
Origin/Sec-Fetch/CSRF machinery exists to stop a hostile page riding an *ambient* credential; there is
none on this path. The cookie path keeps every one of those checks, unchanged.

**Migration `047_admin_native_sessions.sql`** adds the enum value and, unlike 046, cannot express the
CSRF rule as "every non-native channel carries a CSRF pair" — `admin_native` is a bearer transport with
no synchronizer token, so that phrasing would demand a pair on a row that must not have one. Both
halves are restated against the two *cookie* labels: `auth_sessions_web_csrf_present` requires the pair
when `channel IN ('web','client_web')`, `auth_sessions_native_csrf_null` forbids all CSRF material
otherwise. The pair stays exhaustive as further bearer channels are added, and the file still never
names the new label — `ALTER TYPE ... ADD VALUE` may run in a transaction on PostgreSQL 12+, but the
value cannot be *used* until it commits, and the runner wraps each file in one. **This migration must
be applied before the code that writes `admin_native` runs.**

`auth_sessions_active_native_device_uk` is replaced by `auth_sessions_active_bearer_device_uk` on
`(user_id, channel, device_id_hash)` where the channel is not a cookie channel. The old index was
scoped to `channel = 'native'`, so an admin bearer session would have had no same-device backstop at
all. `channel` is in the key rather than only the predicate, so one person carrying both APKs on one
handset cannot collide across audiences.

**Device identity is per scope.** `buildAdminDevice` and `buildClientDevice` are one builder in
`src/platform/nativeDevice.ts` taking the session scope, reading
`boe.admin.installationId` / `boe.client.installationId`. The two APKs therefore enrol as different
devices, and the same-device replacement and the device cap — both now channel-scoped — stay
independent. Signing into the admin APK never evicts the same person's investor session.

**Accepted consequences.**

- **The access token still carries no scope claim**, so the isolation is entirely the channel
  predicate on four call sites plus the channel column on the row. That is deliberate (see the
  rejected alternative) but it means a future authentication path that reads a session without
  comparing the channel is a vulnerability with no type-level warning. `authenticateBearerSession`
  making the channel a required parameter is the mitigation: there is no default and no inference.
- **The contracted `authChannel` labels are not exhaustive.** Admin operations remain `admin-web`
  though those routes accept a bearer token, exactly as client operations remain `native-bearer` though
  those routes accept a cookie after D-052. The labels name the originating transport. Making them
  describe the accepted set is a contract-wide change and was not attempted.
- **A revoked role takes effect on the APK's next start, not immediately.** True of the cookie console
  too: `resolveAdminPrincipal` reads permissions live on every request, so a revocation denies
  authorization at once, but a cached `principal` in Secure Storage may still render the previous
  navigation for one paint. `nativeRestore` reads `getAdminSession` on every start rather than trusting
  the cached copy.
- **Nothing is verified beyond a type-check and unit tests against a stubbed database.** The migration
  has not been applied, the endpoints have not been called, and the admin APK has not been built or
  installed. Entry 026 carries the exact commands.

**Reversible:** the frontend half, yes — one boolean. The backend half leaves an enum value behind,
which PostgreSQL cannot drop, so a revert means abandoning the label rather than removing it. The
constraint and index rewrites are reversible by restating them against `native`.


### D-054
**The checkout allowlist carries the sandbox host on sandbox-capable configs only, and a test pins
which config gets which.** · DECIDED 2026-08-29

`PHONEPE_CHECKOUT_ALLOWED_ORIGINS` is a fail-closed gate: `phonePeCheckoutGateway` runs the
provider's redirect through `trustedCheckoutUrl()` and throws `GatewayMalformedResponseError` when
the host is not listed. The user gets `ErrorState` variant `server` — "Something went wrong on our
side" — and the order stays `payment_pending`. Nothing in the response distinguishes it from any
other server-side failure.

Standard Checkout v2 returns `mercury-t2.phonepe.com` in production and `mercury-uat.phonepe.com`
in sandbox. Only the production host was listed anywhere. So `PHONEPE_ENV=sandbox` — a one-variable
change, and the natural first move when isolating a production-credential problem — broke every
payment, with the same error screen as the problem being isolated. That is what makes this worth a
decision entry rather than a one-line commit: the cost is not the missing string, it is that the
missing string counterfeits the symptom you are trying to diagnose.

**Added to the sandbox-capable examples only** — `backend_controller/.env.example` and
`release_manager/stacks/dev_release/.env.example`. Rejected adding it to the two production examples:
`PHONEPE_ENV` is never `sandbox` there, so the entry could only ever widen what a production stack
will redirect a paying user to. The frontend's `CHECKOUT_ORIGIN_ALLOWLIST` is compiled once for all
builds and cannot make this distinction; it gets the host, which is consistent with it already
carrying `api-preprod.phonepe.com`.

Rejected adding `merchant.phonepe.com` / `merchant-t2.phonepe.com` at the same time. Plausible-looking
and no evidence Standard Checkout ever returns them. An allowlist populated by guesswork is a
different failure mode, not a smaller one.

**The split is now asserted, in `originExamples.test.ts`.** Four example files hold copies of this
key and two of them — the `release_manager` stack examples, which are what a deploy is actually built
from — had already drifted from the `backend_controller` pair. A rule that lives only in an env-file
comment does not survive the next person adding a stack. The guard was checked against a reverted
file to confirm it fails when drifted.

**What this does not do.** It has nothing to do with the failure that prompted it. Payments from
`dev-app.beonedge.in` are blocked by PhonePe with `INTERNAL_SECURITY_BLOCK_1` because the merchant is
onboarded for `www.beonedge.in`; that is a merchant-dashboard change and no allowlist entry affects
it. Recorded so a later reader does not connect the two.


### D-055
**Scripts that drive the live payment merchant carry a hard ₹2 spend cap, enforced against the
screen's own total rather than the value typed.** · DECIDED 2026-08-29

`test_e2e/vps-*.mjs` drive the real production PhonePe merchant, so a defaulted or fat-fingered
amount spends real money. An earlier run created an unintended **₹50,000** order because the script
clicked an amount *preset chip* instead of typing, and nothing checked the amount before submitting.

`test_e2e/lib/amount-guard.mjs` now owns this. Three properties matter:

1. **The cap is a module constant, not an env var.** `BOE_TEST_AMOUNT` may only lower it; `2.5` and
   `500` are both refused. A cap that an env var can raise is not a cap.
2. **It checks the rendered total, not the input.** `fillAmountUnderCap` types the value, reads the
   field back, then reads the figure the screen shows after its "You are investing" label — the one
   `LumpsumInvestScreen` renders from `amountPaise`, which is what the order is actually created for.
3. **It fails closed.** If the total cannot be read, the run is refused rather than proceeding on the
   strength of the input field.

**Rejected: scanning the page for any `₹` figure.** That was the first implementation and it refused
every run, because the invest screen also renders the "Common amounts" preset chips (₹1,000, ₹5,000 …)
and the fund minimum. Checking everything looked stricter and was simply broken — it never once
reached the payment. Precision is the safety property here, not breadth.

Proven **TESTED**: refuses ₹3, ₹500, ₹50,000, `₹50,000`, `0`, empty, junk; allows ₹0.5–₹2; and the
run that followed created order `92dd79b6` at exactly `100` paise.

**Open question this entry does not settle: how the APK gets the user back into the app after paying.**
Recorded here because the answer constrains the checkout contract. Today the backend sends
`redirectUrl: https://dev-app.beonedge.in/dashboard` and Android has no deep link registered, so
paying from the APK lands in a browser. The two candidate designs are not equivalent:

- **Verified App Links** on `dev-app.beonedge.in`. Correct and invisible to the user, but needs
  `/.well-known/assetlinks.json` served from that host and a *stable signing certificate* — the
  release APKs are currently unsigned, so this cannot be completed until signing exists.
- **A custom scheme** such as `beonedge://payment-return`. Works immediately with no hosting and no
  signing, but PhonePe may reject a non-https `redirectUrl`, and a custom scheme is claimable by any
  other installed app.

Not decided. It needs the signing question answered first, and it needs the payment block lifted
before any of it can be tested end to end.

**Related, and separately unproven: `Transacting_URL` is derived from `merchantUrls.redirectUrl`.**
Established by elimination, not by a successful request. `vps-referrer-probe.mjs` ruled the browser
out — `Transacting_URL` stayed `https://dev-app.beonedge.in/` with no referrer at all and when
claiming `https://www.beonedge.in/` — and `redirectUrl` is the only field in the entire pay payload
that carries a domain, its origin matching what PhonePe reports character for character. If that
inference holds, pointing the checkout redirect at the onboarded domain would lift the block without
a dashboard change, which needs `redirectUrl` decoupled from `PHONEPE_CALLBACK_URL` (the webhook,
which must stay on the stack that owns the payment records). Deliberately not implemented: the
cheaper and already-proven route is the sandbox merchant, and adding a config seam on an untested
inference would be speculation with a permanent maintenance cost.


### D-056
**The checkout return URL is its own setting, and the approved host it points at is served by the
landing site with a closed redirect map.** · DECIDED 2026-08-29

Supersedes the "deliberately not implemented" paragraph at the end of D-055. That entry declined to
build this on the grounds that the `redirectUrl` → `Transacting_URL` link was inferred rather than
proven. PhonePe then confirmed it in writing — "URL used to receive payments:
https://dev-app.beonedge.in/ / Approved URL: www.beonedge.in" — and the maintainer asked for the
route through `beonedge.in` explicitly. The reasoning for declining no longer holds.

**Why `PHONEPE_CALLBACK_URL` could not be reused.** It is validated by `canonicalUrl()` against
`expectedHost`, which is `dev-app.beonedge.in` in development and `app.beonedge.in` in production.
That constraint is correct for a webhook — a callback that reached a different stack would record
payments against the wrong database — and it is exactly wrong for the browser return, which must sit
on whatever host PhonePe has approved. One value cannot satisfy both rules, so there are two values.
`browserRedirectUrl()` keeps everything except the host locked down: HTTPS only, no embedded
credentials, no fragment.

**Defaulting to the old derived value.** `new URL("/dashboard", callbackUrl)` remains the default when
the key is unset, so this is not a breaking change for a deployment that has not been touched. The
setting is opt-in, which also means the failure mode of forgetting it is the *previous* behaviour
rather than a crash.

**Rejected: a `?to=` parameter on the landing route.** The obvious shape — one route that redirects
wherever the query string says — makes an **open redirect on a domain PhonePe has approved for
payments**, reachable from any phishing email and wearing a trusted brand. The route uses a closed map
of two keys with a 404 fallback instead. Query parameters are still forwarded, because PhonePe may
append them, but they cannot influence the destination host.

**Rejected: an nginx change on `www.beonedge.in`.** Initially it looked necessary, because that server
block ends in a catch-all `return 301` to the apex and a server-level `return` runs before location
selection, so a new `location` there would be unreachable. But the 301 preserves `$request_uri`, so
`www/pay/return/dev` → `beonedge.in/pay/return/dev` reaches the landing app anyway. One extra hop in a
browser redirect nobody waits on, against touching a shared nginx config that also serves the
marketing site. Confirmed live: `curl -I https://www.beonedge.in/` → `301` to the apex.

**This is still unproven end to end.** No payment has completed. If PhonePe turns out to validate
against something in the merchant record rather than the redirect origin, this buys nothing and the
dashboard remains the only route. Recommended to the maintainer as the second choice for that reason —
adding `dev-app.beonedge.in` and `app.beonedge.in` as approved URLs is certain, needs no code, and
`Onboarding_URL` arriving as a JSON array suggests multiple approved URLs are supported. The two are
not exclusive; this one also covers production, where the same block is waiting.

**Source comments.** The maintainer asked for none in source files. `tools/strip-comments.mjs` does it
with the TypeScript parser rather than regex, because this codebase contains URLs with `//`, regex
literals like `/https?:\/\/[^/]+\/\//u` and template strings containing `//`, all of which a regex
stripper corrupts. Directive comments are preserved — removing `eslint-disable` or `@ts-expect-error`
would break the very gates that verify the change. Applied only to this session's files so far. A
repo-wide sweep is 1,073 comments across 150 files and is left undone pending an explicit decision,
because a large share of them record why a check exists and this log cross-references them.
