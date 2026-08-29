# 017 — Web credential persistence, one verification-state field name, one percentage formatter

Three findings from the audit of this blueprint against the tree. Decisions: D-037, D-038, D-039.
Log: Entry 021.

## 1. The client web build wrote refresh tokens to `localStorage`

`createClientRuntime` chose its persistence port by platform but hard-coded
`persistSecrets: true`. On Android that is correct — the port is Capacitor Secure Storage. In a
browser the port is `localStorage`, and the browser is a shipped configuration: `Dockerfile`
defaults `VITE_BEO_APP_TARGET=client`. So `boe.client.accessToken` and `boe.client.refreshToken`
sat in `localStorage`, where a single injected script could lift a refresh token and mint
sessions indefinitely. `createAdminRuntime` had already got this right.

```
-  if (native) purgeLegacyLocalSecrets()
+  purgeLegacyLocalSecrets()
   const tokenStore = createTokenStore({
     persistence: native ? createSecureStoragePersistence() : createWebPersistence(),
-    persistSecrets: true,
+    persistSecrets: native,
   })
```

Two lines, because the token store was already built for this: it holds every field in memory and
asks `shouldPersist(field)` before writing, and `SECRET_FIELDS` is already
`["accessToken", "refreshToken"]`. Moving the purge out of the `native` guard matters as much as
the flag — without it, a browser that already holds leaked secrets keeps them.

**The trade-off you must know about.** The client web build no longer survives a reload. In-memory
tokens die with the document; `restore()` then finds a persisted `principal`, no access token, and
a refresh attempt with no refresh token, so it resolves to `anonymous`. The user signs in again.
Android is untouched. Making web reload-durable means a cookie-based refresh for the client scope,
which the backend does not have — `web-auth` issues cookies for admin only — and that was out of
scope here. D-037 has the full argument.

## 2. The verification-state field had two names

The contract requires `emailVerificationState`; the route returned `emailVerificationStatus`. The
transport validates every response against the contract, so the first caller of
`useEmailVerificationStatus` would have taken a malformed-response error rather than data. It has
no caller — `VerificationStatusScreen` reads `useEligibility()` — which is the only reason this was
invisible.

Everything else in the system already agreed on `emailVerificationState`: the contract, `db/types.ts`,
the repositories, the eligibility payload, and doc 04 line 247. So the backend was renamed, not the
contract, and there was nothing to regenerate. Both `sendData` calls in the file were renamed,
including `/verify`, whose contract is `z.looseObject({})` and would have accepted either — leaving
one route on the old name would have preserved exactly the inconsistency being closed.

`admin-oversight` deliberately uses `emailVerificationStatus` in its own contract *and* its route.
It is self-consistent and was not touched.

The hook stays. Deleting it means deleting the contracted operation, which is a documented endpoint
with an obvious future consumer, and the bypass check's operation count would have to move with it.
Renaming a field on the side that was already wrong is the smaller change. It remains an unconsumed
query, which is a code-cleanliness matter, not a defect.

## 3. Three percentage formatters where the plan requires one

`chartMath.ts::formatShare` at one decimal, plus `toFixed(2)` written out by hand in
`DashboardScreen` and `PortfolioScreen`, each with its own sign handling. Doc 10 and doc 11 exist in
part to stop precisely this: it is the legacy `formatReturnPct` (2 dp) / `fmtPct` (1 dp) split, now
in triplicate.

`domain/percent.ts` is the single home:

```ts
formatPercent(12.3456)                      // "12.35%"
formatPercent(-3.5)                         // "-3.50%"
formatPercent(3.5, { showSign: true })      // "+3.50%"
formatPercent(0, { showSign: true })        // "0.00%"
formatPercent(null)                         // "—"
```

It lives in `domain/` beside `money.ts` because a return percentage is a financial figure — the same
reasoning that already put percentages on the money type recipes — and it mirrors `formatINR`: same
`showSign` option name, same rule that a sign is only added when the value is strictly positive.

Two decimals is the deliberate choice. The highest-stakes percentage here is a return figure read
beside a rupee amount, where a tenth of a percent is information; an allocation share carrying one
redundant decimal is cosmetic. Precision is a module constant on purpose — an optional precision
argument with a default is how the legacy split happened in the first place.

**What a user sees change.** Donut legends and the donut's `aria-label` render `42.31%` instead of
`42.3%` (fund detail sector allocation, admin fund holdings). A return of exactly zero renders
`0.00%` instead of `+0.00%`, which is what the money cell beside it already does with zero growth.
Nothing else moves.

`FundHoldingsScreen`'s `weightPercent` was left raw: the contract types it as a decimal *string*
(`Decimal24x8`), and pushing it through a number formatter reintroduces the float conversion the
string type exists to prevent.

## Commands

Run from `frontend_stack_ts` unless stated.

```
npx tsc -p tsconfig.json --noEmit
npx eslint .
npx vitest run
VITE_BEO_APP_TARGET=client npx vite build
(cd ../packages/contracts && npm run check:frontend-contract-bypass)
(cd ../backend_controller && npx tsc -p tsconfig.json && npx vitest run)
```

All green: 134 frontend tests including 9 new ones, 676 backend unit tests, 94 contracted operations
with no bypasses. The three browser-persistence assertions were confirmed to fail against the
pre-fix code, so they guard the regression rather than merely describing the fix.

## What none of that proves

A green suite here does not exercise wiring. Unverified, needing the VPS or a device:

- the renamed field on a real response —
  `curl -sS -H "authorization: Bearer $ACCESS" -H 'x-client-platform: android' -H 'x-app-version: 0.1.0' https://<host>/api/v1/client/email-verification-status | jq`
- the web reload behaviour: sign in on the deployed client web build, confirm no
  `boe.client.accessToken` / `boe.client.refreshToken` in `localStorage`, reload, expect sign-in
- native token durability across process death, on an APK, and that the purge on native start
  touches `localStorage` only
- the rendered percentages on dashboard, portfolio, fund detail and admin fund holdings
