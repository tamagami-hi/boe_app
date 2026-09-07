# TASK 009 — Admin fund and AUM management

Date: 2026-08-28
Log entry: [017](../LOGS/implementation_log.md)

## Scope, held deliberately narrow

Create a fund, publish its terms, move it through its lifecycle, and record its AUM. Nothing else.
The holdings editor, collective AUM growth and the preview-then-commit protocol remain placeholders
because they were not asked for and each adds real complexity.

Four screens, all against operations already contracted in `admin-fund-aum`:

| Screen | Does |
|---|---|
| `FundListScreen` | State filter, search, per-state counts, one row per fund |
| `FundCreateScreen` | One form: identity, terms, opening AUM — a single request |
| `FundWorkspaceScreen` | Current state, publish a new terms version, legal lifecycle transitions |
| `FundAumScreen` | Opening AUM when unset, otherwise signed amount or basis-point growth, plus history |

## Three defects the browser found

**The admin role gate locked out the superadmin.** Every admin route declares `role: "admin"`; the
seeded principal carries `superadmin`. `hasRole` demanded the literal string, so fund creation
answered Forbidden. The backend never requires a literal `admin` role — `getSession` rejects zero
roles and each route enforces permissions. Fixed so `"admin"` means any admin-capable role. This one
mattered: the console was unusable by its own superuser.

**The workspace offered transitions the backend forbids.** It showed a button for every state except
the current one, so Pause appeared on a draft and answered `STATE_CONFLICT`. The UI now mirrors
`ALLOWED_TRANSITIONS`, and Publish is disabled while no version exists.

**My copy was wrong.** The create screen claimed a fund is made as a draft awaiting publication. It
is created as a draft with version 1 of its terms already written. The database said so.

## Verification

**45 of 45 checks in Chromium.** One pass proves the whole chain: create, confirm invisible to
investors, confirm Pause is refused on a draft, publish, pause, republish, record 250 basis points of
growth — then switch to the client and find the fund at **exactly ₹51,25,000**, grown from
₹50,00,000, with the administrator's disclosure and terms rendered.

The rupee figure is asserted literally, so the growth arithmetic is verified, not assumed.

All three project gates exit 0.

## Not done

No money has moved — orders, payments, SIP and AutoPay are placeholders and PhonePe is unconfigured
locally. The remaining admin domains and client surfaces are placeholders. No holdings are disclosed
on any fund. No emulator run, no APK, no container build.
