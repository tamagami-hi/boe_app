# 007 — Final sweep

## What was done

A script checked **60 removed symbols** — every removed export, repository method, type, interface,
configuration key and shell function — across `.ts`, `.tsx`, `.mjs`, `.js`, `.sh`, `.yml`, `.yaml`,
`.json`, `.conf`, `.css`, `.example` and `.xml`, over `backend_controller`, `frontend_stack_ts`,
`packages/contracts`, `release_manager`, `test_e2e`, `tools`, `emu` and `.github`.

This ran **after** a green `tsc`, a green `eslint` and 199 + 804 passing tests. It still found three
things, which is the whole argument for doing it.

## The three leftovers

**`sipScheduleWorker.test.ts` — two dangling `vi.fn()` stubs.** `lockByIdUnscoped` and
`findOpenInstallment`, for repository methods deleted two passes earlier. Invisible to the
type-checker because the mock object is cast `as unknown as`, which is exactly the escape hatch that
makes hand-built test doubles convenient and makes them rot silently.

**`platform/systemChrome.ts` — `pushSystemChrome` was never actually removed.** I had it in the
verification list and omitted it from the removal script. A green build and 199 passing tests said
nothing, because an unused export is not an error.

That third one is the consequential miss. Removing it exposed the dead push/subscribe subsystem
described in `005-frontend-dead-code.md`: `pushSystemChrome` was the sole writer to the chrome stack
and the sole caller of `notify`, so `getSystemChrome()` had always returned the default and
`subscribeToSystemChrome` had never been able to emit a change. Without this sweep the whole layer
would have survived, and the audit would have reported a subsystem as working when it never had been.

All three fixed, and the full gate set re-run afterwards.

## The three hits that were correct as they stood

The sweep is only useful if it distinguishes a leftover from a deliberate reference. Three hits
remain and all three should:

**`test_e2e/onboarding-harness.test.mjs:50`** —
`assert.doesNotMatch(source, /createLogEmailSender/u)` against `composition.ts`. A **negative** guard
preventing reintroduction of the fail-open email sender. It is both the evidence that removing it was
safe and the reason the symbol still appears in a grep. Same category as the razorpay deletion guard
at `legacy-deletion.guard.test.ts:46`.

**`stacks/dev_release/.env.example:191-192` and `docker-compose.dev_app.yml:92-93`** —
`ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET` and `ALLOW_DEV_AUTH` appear as text inside comments
explaining why those keys are deliberately absent. Not live configuration. A note explaining an
absence is more useful than the absence alone, and the root `README.md`'s no-comments rule governs
source code, not env templates.

## Gates, after

| Gate | Result |
| ---- | ------ |
| `backend_controller` `npm run check` | typecheck, lint, **804 tests / 79 files**, build, `smoke:source`, `smoke:dist` — exit 0 |
| `frontend_stack_ts` | typecheck, lint, **199 tests / 21 files**, build, `check-bundle-boots` (7 chunks), `check-phonepe-native-target` |
| `packages/contracts` `npm run check` | OpenAPI validates; "No contract bypasses. 101 contracted operations" |
| `release_manager/tests/*.test.sh` | **15 / 15** |
| `release_manager/verify.sh` | **108 passed, 0 failed**, 1 skipped (remote) |
| `npm run test:onboarding:harness` | 7 pass, 0 fail |

One gate reports a difference by design: `generate:api:check` diffs generated output against git, so
an uncommitted regeneration always fails it. Verified instead that the generator is **idempotent** (a
second run produced a byte-identical file) and that the diff is **108 deletions, zero additions**.

## Measured reduction

```
77 files changed, 685 insertions(+), 1457 deletions(-)      net -772
```

`backend_controller` −153 · `frontend_stack_ts` −389 · `release_manager` −114 · `test_e2e` −117 ·
root docs +1.

The backend figure understates the removal, because its insertions are mostly three lifecycle fixes
and five new tests. `src/db/repositories.ts` alone went from 507 lines to 77.

**Bundle size is unchanged to the byte** — 216.05 kB app chunk before and after. The dead frontend
exports were already tree-shaken. Saying so plainly is better than implying a win that did not
happen: this bought clarity, not size.

## What to check next

Everything unverified is listed in `../09-verification-results.md` §4. The three that need action:

1. `sudo nginx -t && sudo systemctl reload nginx` — the rate-limit fix is inert until then.
2. The read-only SQL in `../02-lifecycle-and-state-machines.md` §6 — the code no longer creates
   wedged rows, and existing ones are not retroactively repaired.
3. Rebuild and install both APKs — the plugin and permission removal changes their contents.

And one method note for whoever audits this next: **run a symbol sweep even after a green build.**
An unused export is not a type error, a stub in an `as unknown as` mock is not a type error, and a
removal script that quietly skips an entry is not a type error either. All three happened here.
