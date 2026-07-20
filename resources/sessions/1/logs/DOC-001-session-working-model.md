# DOC-001 Phase Log: Session Working Model And Reorganization

## Objective

Create a BOE-specific execution/logging model based on the referenced algo
engine model, reorganize Session 1 into functional directories, create a full
TypeScript replacement/deletion ledger, and make the current resume point
self-contained without touching `resources/sessions/Legacy`.

## Atomic Units

- [x] Read the reference working model completely.
- [x] Reconcile direct-replacement intent with Session 1 authority.
- [x] Move handoffs, plan, specifications, and progress into named directories.
- [x] Create the working model, task ledger, status records, metrics, and logs.
- [ ] Repair and validate every moved-document link/path statement.
- [ ] Verify task inventory counts and Legacy tree hash.
- [ ] Run documentation review and resolve findings.
- [ ] Commit, push, mark `DOC-001` done, and select the next active task.

## Current File Layout

- Root: `README.md`, `WORKING_MODEL.md`, `TASKS.md`.
- `handoffs/`: historical intake and planning completion.
- `plans/`: master phase plan.
- `specifications/`: product, schema, API/security, and tooling authority.
- `status/`: current resume, progress, validation, and metrics.
- `decisions/`: binding cross-task risks and decisions.
- `packets/`: complete execution packets required before a workstream is ready.
- `logs/`: immutable per-task execution evidence.
- `templates/`: required task/log formats.

## Safety Boundary

The `resources/sessions/Legacy` tree is excluded from all moves and edits. Its
pre/post tree hash must match before this task lands.

## Validation

Pending link, path, task-state, inventory, Legacy hash, diff, and independent
documentation review gates.
