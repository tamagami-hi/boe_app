# Task 001 — Forensic investigation and architecture documentation

**Log entry:** [001](../LOGS/implementation_log.md)

## Goal

Determine what the BOE application actually does, identify the canonical backend contracts and
active product features, and produce an implementation-ready blueprint for a greenfield TypeScript
frontend. Documentation only — no source changes.

## What was produced

The 14-document tree in this directory, ~5,900 lines. Seven parallel investigations: backend
contract surface, legacy client forensics, legacy admin forensics, auth and Email OTP Verification,
payments/SIP/AutoPay, Android packaging and deployment, and the prior audit corpus.

## The findings that shaped the plan

**The backend is in good shape; the frontend is where the decay is.** 49 typed tables, one canonical
settlement transaction, five test-enforced architecture guards, a documented 24-code error
catalogue. The problems are all on the frontend side and they are structural rather than cosmetic.

**No enforced layout primitive.** Seven of eleven client layout wrappers have zero importers, yet all
seven are still re-exported as the package's public API — while the pages hand-write the very classes
those wrappers exist to emit (`be-card` × 63, `be-btn` × 58). Page width, padding and safe-area
handling are therefore decided independently twenty-plus times. This single fact explains most of the
inconsistency.

**Four class vocabularies**, two of them inside the same element
(`FundDetail.jsx:471`). Admin's own stylesheet header admits `.ash-` "coexists with the legacy
`.adm-` styles while old screens await their per-domain rebuild".

**No responsive system.** Three "small phone" breakpoints in two units that do not coincide, and **no
tablet or desktop breakpoint anywhere in the client CSS** — which is the stylesheet the browser build
serves. Eight page-width containers spanning 420–780px.

**Real capability with no navigation to it.** `/app/mandates/:mandateId` holds SIP pause, resume,
cancel and mandate re-authorisation, and is reached only programmatically from the SIP creation sheet
with `{replace: true}`. After that session ends, a user cannot return to manage their SIP.

**Features that look real and are not.** Explore's "notify me" calls no API. `markAllRead` has no HTTP
call. Statement download does not exist.

**A trust-boundary bypass.** `Notifications.jsx:89` hands a server-supplied `deepLink` straight to
`navigate()`, bypassing the resolver the route manifest exists to provide.

**Fixture mode is a production code path**, not test data, and three of five fixtures are empty
arrays — so a default build signs in as a fake user with a fake balance and no history.

**The device app-lock PIN is not a security boundary** and reads like one: a single unsalted SHA-256
over a 4–6 digit space in `localStorage`, no attempt counter, no lockout, no server call, and the app
tree renders live behind the overlay while the token store keeps serving the bearer token.

**One part of the legacy styling layer is genuinely excellent** and must be ported verbatim: the
safe-area token contract in `design-tokens/src/tokens-core.css`, with its
`var(--safe-area-inset-*, env(safe-area-inset-*, 0px))` chain and the scan test that enforces sole
ownership. Every constraint in it exists because of a defect that shipped.

## Method note

Each investigation was told to distinguish what a document *claims* from what was *verified in code*.
That mattered: the prior audit corpus contains several confidently wrong numbers — 55 typed tables
(actually 49), 30 migrations (actually 34), the contracts package located under `frontend_stack`
(it is at the repository root), and `risk_assessments` described as read by eligibility logic (zero
references anywhere in `src`). Two documentation sets still describe Razorpay as live and recommend
"defer Razorpay"; Razorpay is fully dead.

Later, VPS inspection in Task 002 corrected two of my own doc-derived claims in turn — migration 042
**is** applied on dev, and the dev port map differs from what I recorded.

## Outcome

14 documents. Seven blockers identified, of which four were closed in Task 002. The two extra
findings (`Notifications.jsx:89` and the SIP reachability hole) were deliberately left unfixed
because they live in `frontend_stack`, which must stay untouched — both are resolved in the target
design instead.

## Verification

STATIC throughout. `git status` confirmed the 31 pre-existing uncommitted changes were byte-identical
before and after.
