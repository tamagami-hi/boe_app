# Task 016 — the mandate redirects could strand a user, and status exhaustiveness was fiction

2026-08-29. Two findings from the audit of this blueprint against the working tree. Both are defects of
omission in `frontend_stack_ts`, and both survived every green gate.

## What was wrong

**The pending record was written before one redirect out of three.** Payment safety rule 4 in doc 07
requires the pending record to be written and the write verified before handing the user to a provider
checkout URL, aborting if the write fails. `LumpsumInvestScreen` did exactly that.
`SipStartScreen` (AutoPay mandate setup) and `SipDetailScreen` (setup retry) called
`window.location.assign` with nothing recorded. `PendingPaymentRecovery` reads that record and is the
only recovery mechanism in the app, so leaving for PhonePe from either screen meant coming back to no
route at all.

**`domain/status.ts` proved nothing.** Sixteen unions were hand-written string literals that happened to
match `packages/contracts`. `assertNever` therefore only proved the file was exhaustive over its own copy;
a new backend status produced no type error and would have landed as an unmapped string at runtime — the
opposite of what doc 07 promises.

## What changed

`persistPendingPayment` now guards both mandate redirects, with the same abort-and-explain shape as the
reference implementation. The existing helpers and the existing key are reused.

`PendingPayment` became a discriminated union on `kind`: `"order_payment"` unchanged,
`"mandate_setup"` additionally carrying `sipPlanId`. A mandate authorisation recovers to
`/sips/{sipPlanId}`, where the mandate state is authoritative; an order payment recovers exactly where it
did before, with the same copy. A record with no recognised `kind` is discarded rather than misread.
See D-036.

The two SIP screens' failure alerts gained a per-failure title. The static titles ("Nothing was created",
"Nothing changed") are false on this branch — by the time the write fails, the plan and the setup attempt
exist — and an alert that contradicts itself is worse than none. Every pre-existing message keeps its
original title.

Every status union is now `z.infer` of the contract enum, re-exported under its existing name. The
presentation mappings (label + tone) are untouched. `SipCollectionMode` has no named contract enum, so it
is derived as `AdminMandateDetailData["sip"]["collectionMode"]`.

## Files

- `src/features/payments/pendingPayment.ts` — union shape, per-kind validation
- `src/features/payments/pendingPayment.test.ts` — three added cases for the new branch
- `src/features/payments/PendingPaymentRecovery.tsx` — per-kind copy and destination
- `src/features/orders/LumpsumInvestScreen.tsx` — `kind: "order_payment"`
- `src/features/sip/SipStartScreen.tsx` — persist-verify-abort before the mandate redirect
- `src/features/sip/SipDetailScreen.tsx` — the same before the retry redirect
- `src/domain/status.ts` — type source only

## Verified — TESTED

`npx tsc -p tsconfig.json --noEmit`, `npx eslint .`, `npx vitest run` (12 files, 134 tests),
`VITE_BEO_APP_TARGET=client npx vite build` — all clean.

The exhaustiveness guarantee was negative-tested. A temporary `hibernating` member on the contract
`SipState` produced `src/domain/status.ts(155,26): error TS2345: Argument of type '"hibernating"' is not
assignable to parameter of type 'never'.`, reverted afterwards. The same edit produced no error before
this change.

## Not verified — UNVERIFIED

No redirect was executed and no `localStorage` write was made to fail, so neither the abort path nor the
recovery banner has been observed. On the VPS with AutoPay configured: start a mandate from the SIP
screen, leave for PhonePe, return, and confirm the banner reads "You have a mandate authorisation in
progress" and opens `/sips/{sipPlanId}`; then deny or exhaust origin storage and confirm the button
surfaces "We stopped before the mandate page" with no navigation.
