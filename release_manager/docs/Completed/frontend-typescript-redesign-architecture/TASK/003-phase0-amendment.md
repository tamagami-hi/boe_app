# Task 003 — Phase 0 resequenced

**Log entry:** [006](../LOGS/implementation_log.md)
**Decisions:** [D-001](../LOGS/risk_and_decision.md#d-001) ·
[D-002](../LOGS/risk_and_decision.md#d-002) · [D-005](../LOGS/risk_and_decision.md#d-005)

## Why this task exists

The plan I wrote in Task 001 said: extend `packages/contracts` to full coverage before writing any
UI, on the grounds that hand-typed API shapes are how the legacy frontend accumulated 60 uncontracted
paths.

Then I measured the cost. `admin-fund-aum.ts` is **782 lines for 8 operations**, because each carries
full request and response Zod schemas. Roughly 75 operations remain, so full coverage is ~7,000 lines
of descriptors written blind, before a single screen exists to exercise any of them. Meanwhile
Phase 1 needs almost none of it — the foundation needs the transport and `GET /v1/health`.

That is the wrong shape, and I said so rather than executing my own plan literally.

## What changed

**Contracts and backend corrections are now extended per feature phase**, immediately before the
phase that consumes them.

The reason this is safe now and was not when the plan was written: Task 002 made
`check-frontend-contract-drift.mjs` scan `frontend_stack_ts/src`. The moment the new frontend calls an
uncontracted path, CI fails. The guard that was absent while the legacy frontend drifted is in place,
so the discipline no longer has to be manual.

**Backend corrections promoted from "consider" to mandatory** (D-002), on the maintainer's point that
shaping the API around a frontend scheduled for deletion is backwards. The application is
pre-production with no real users, so the contract is shaped for the new frontend and the legacy
frontend is allowed to break as a consequence.

Six items moved from optional to required: move `outcome` into the decision body rather than
contracting the `?outcome=` wart; delete the `/email-verification/resend` alias; add server-side
transaction filtering; add bulk mark-all-read; collapse the checkout shape to `{type:'redirect'}`
only; wire the fund-detail cache invalidation that already exists and is never called.

**But not speculatively.** Each is assigned to the phase that consumes it, for a reason unrelated to
legacy: an unconsumed API change is an unverified one, and until the new frontend reaches parity,
`frontend_stack` is the only working end-to-end system on the dev stack. Deliberately breaking it
early costs the only integration surface available for ten phases.

**Drift baseline target recorded as `uncontractedPaths: []`** (D-005). The current 60-entry baseline
records *legacy* drift and must not be inherited. At cutover the baseline is emptied and only the new
tree is scanned — a one-line change given D-004.

## Also settled here

**B1 no longer gates Phase 1.** The maintainer decided migration 043 is verified together with the
new frontend when the new stack is deployed, with a schema backup. It remains a hard prerequisite for
**Phase 7**, the first phase whose code depends on the relaxed constraint.

Two supporting facts found in Task 002 make that safe: migration ordering is structural, not
procedural — the compose `migrate` service runs before the backend by `depends_on`, so 043 applies
automatically once it is in the image — and `rollback.sh` supports a cheap image-only rollback
(`--dev --to <version>`, `--list`) with a separate, explicitly destructive `--restore-db` path that
backs up current first.

## Changed

- Doc 10 Phase 0 rewritten; 97 superseded lines removed.
- Doc 10 Phase 1 prerequisites updated to state it is not blocked by B1.
- README status, amendment note, and recommended starting point.
- Doc 00 blocker table row for B1, now citing verified VPS evidence.
- Doc 01 migration, port-map and worker-set facts corrected from VPS observation.

## Verification

STATIC. Documentation only. The claims it now records about the dev stack were verified read-only in
Task 002.
