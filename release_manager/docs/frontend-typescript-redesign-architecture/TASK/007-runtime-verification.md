# TASK 007 — First runtime verification of the new frontend

Date: 2026-08-28
Log entry: [015](../LOGS/implementation_log.md)
Decision: [D-027](../LOGS/risk_and_decision.md#d-027)

## Why this mattered

Everything through TASK 006 was static: typecheck, lint, `vitest run`, one-shot builds and JSDOM
chunk evaluation. None of that exercises wiring. Doc 12 names three defects this repository shipped
with a green suite, and this task exists to stop guessing.

## The stack

The VPS could not serve it. Its dev stack is at migration `042`, so it does not carry the
hosted-checkout backend, and its `WEB_ORIGIN_ALLOWLIST` has no local origin. A local stack was
required: `test_e2e/local-stack.sh` for a throwaway Postgres and Mailpit, the backend from `dist/`
on 47502 with a purpose-built env, and two Vite servers for the client and admin targets.

**All 37 in-tree migrations applied from empty, including 043, 044 and 045 — the first time those
three have run anywhere.**

## Five defects, and what each one says

| # | Defect | Why no test would find it |
|---|---|---|
| 1 | CORS `ALLOWED_HEADERS` omitted `x-client-platform` and `x-app-version`, which the native auth contract requires, so every browser login died at preflight | Preflight is browser behaviour; the request never reaches a handler |
| 2 | `npm run dev` served the **admin** shell on the client port, because `vite.config.ts` defaults the target to `admin` and the script never set it | Both targets typecheck, lint and build identically |
| 3 | The token store purged its own credentials during hydration on web, so every page load dropped the session | The purge is correct on native; only the platform branch was wrong |
| 4 | The admin console could not hold a cookie: `localhost:5175` to `127.0.0.1:47502` is cross-site, so `SameSite=Lax` cookies were never stored | Requires a real cookie jar and a real `Sec-Fetch-Site` header |
| 5 | Four of the superadmin's 31 permissions were missing from the union and silently filtered out | The filter is type-correct; the data was wrong |

Defect 4 is the one worth dwelling on. Doc 01 already documents it as a shipped production failure
for the admin image, with the same three simultaneous causes and the same resolution. The design
answer existed; the development topology simply did not follow it. It does now (D-027), which also
means `resolveApiBase()`'s same-origin branch — the one D-010 added for promotable artifacts — is
exercised rather than assumed.

## Verification

TESTED. `test_e2e/frontend-ts-smoke.mjs` in Chromium, **19 of 19 checks**, covering both shells,
both auth transports, tab and sidebar navigation, direct entry to `/sips`, unknown paths, unbuilt
surfaces announcing themselves, client session survival across a page load, admin CSRF recovery, the
responsive nav switch, and zero page errors and zero failed requests.

Gates: `backend_controller` exit 0 / 676 tests, `packages/contracts` exit 0, `frontend_stack_ts`
exit 0 / 90 tests.

UNVERIFIED: no money has moved — no order, payment, SIP or mandate, because PhonePe is unconfigured
locally and `/pay` answers `DEPENDENCY_UNAVAILABLE` by design. No email OTP round trip. 47 of 55
routes are still the not-implemented state. Nothing has run on the emulator and no APK exists.

## Cleanup

Both Vite servers, the local backend, `boe-local-pg` and `boe-local-mail` were stopped and removed
in the same session. The maintainer's own containers were left alone.

## Next

The loop is now real: a local stack plus a browser harness that fails loudly. Build Phase 4 onward
against it, extending contracts per phase, and add a smoke check per surface as it lands. Phase 7
needs PhonePe sandbox credentials in the local env before a payment can be proven end to end.
