# BOE Rearchitecture Working Model

This is the operating model for the PostgreSQL and TypeScript rearchitecture.
It adapts the discovery, bounded-pass, validation, phase-log, and removed-history
ideas from `/home/nethunter07/PROJECTS/algo_engine/WORKING_MODEL.md` to this
repository's direct-replacement migration.

## 1. Authority And Intent

The target is a complete production TypeScript/TSX replacement of authored
backend and frontend JavaScript/JSX. A migrated dependency closure becomes the
only authoritative implementation and its superseded JavaScript/JSX production
and test files are deleted in the same task packet.

The old application does not have to remain runnable between packets. This does
not relax PostgreSQL forward-migration safety, external API compatibility,
security controls, evidence retention, or released-client support.

`resources/sessions/Legacy/**` is outside this working model and must never be
edited, moved, renamed, reformatted, or used as the active task authority.

## 2. Discovery Order

Every code task starts from the active records, not ad hoc browsing:

1. `README.md` for the session map and resume point.
2. `status/CURRENT.md` for the one active task and last verified commit.
3. `TASKS.md` for workstream dependencies and the active packet link.
4. The active file under `packets/` and its task log under `logs/` to avoid
   repeating completed work. Logs are evidence, not normative overrides.
5. `decisions/RISKS_AND_DECISIONS.md` for binding decisions and open risks.
6. `plans/01-postgresql-typescript-rearchitecture-plan.md` for phase order.
7. The relevant files under `specifications/` for domain, schema, API,
   security, tooling, and test constraints.
8. The current source dependency graph and tests for the selected seam.
9. GitHub code search, then primary vendor documentation, then registries; use
   broader web discovery only if those are insufficient.

Discovery ends with an explicit replacement closure: new files, imported
dependencies, tests, old files to delete, data/API compatibility constraints,
and exact validation commands.

## 3. Selection Rule

Select the highest-priority `READY` task whose dependencies are `DONE` and that:

- replaces one dependency-closed behavior or surface;
- has one dominant risk;
- can reach a verifiable checkpoint without speculative adjacent work;
- names every superseded JS/JSX file or glob before implementation;
- does not require an unreplaced JavaScript module in production output; and
- preserves database/external compatibility where the specifications require it.

Do not choose work merely because a file is small. Choose the next closure that
advances the target architecture and can delete real legacy code safely.

## 4. Workstreams, Task Packets, And Atomic Units

`TASKS.md` rows are dependency-ordered workstreams, not sufficient execution
packets by themselves. Before a workstream can become `READY`, create
`packets/<TASK_ID>-<short-name>.md` from the task-packet template with every
required field complete. `TASKS.md` links that packet. Before it becomes
`ACTIVE`, create its dedicated phase log and decompose it into atomic units
targeting roughly fifteen minutes each. Every unit has one assertion and one
clear done condition.

A task packet must record:

- task ID, objective, owner surface, dependencies, and status;
- normative sources and research/reuse evidence;
- production files to add or replace;
- exact legacy production/tests/config files to delete;
- intentional behavior changes and compatibility constraints;
- RED capability and regression tests;
- build, lint, coverage, integration, E2E, image, and security gates that apply;
- rollback shape; and
- exact production TS, test TS, tooling TS, and removed JS/JSX metrics.

Only one task packet may be `ACTIVE`. A workstream may be split into child
packets before implementation; preserve the parent ID and do not silently
expand an active packet. A row without a complete packet cannot be `READY`.

## 5. Task States

| State | Meaning |
|---|---|
| `BACKLOG` | Defined but dependency or design work remains |
| `READY` | Dependencies, closure, deletion target, and acceptance are known |
| `ACTIVE` | The sole task currently being executed |
| `REVIEW` | Implementation is green and mandatory reviews are running |
| `BLOCKED` | Cannot progress safely; log the exact external decision or state required |
| `DONE` | Code, deletion, validation, review, metrics, log, commit, and push complete |

Milestone status changes are written to `TASKS.md`, `status/CURRENT.md`, and the
task log in the same commit as the evidence that justifies the change.

## 6. Eval-First And TDD Loop

Each implementation unit follows this loop:

1. Define the capability eval and regressions before editing production code.
2. Run the focused test and record the expected RED failure signature.
3. Implement the smallest production TypeScript change that can pass.
4. Delete superseded JavaScript/JSX and its obsolete tests/configuration.
5. Run focused GREEN tests.
6. Refactor without changing the contract.
7. Run package coverage and the packet's broader acceptance matrix.
8. Run code/TypeScript and security review; add review findings as RED tests
   before fixes whenever the finding is behaviorally testable.
9. Re-run all gates and record exact evidence.

Tests must not merely prove renamed files compile. They must prove the intended
contract, failure boundary, deletion, and absence of legacy imports/output.

## 7. Replacement And Deletion Rule

A replacement packet is complete only when:

- production source is authored in strict TypeScript/TSX;
- `allowJs:false` applies to the migrated package;
- authoritative builds contain no legacy application JavaScript;
- new TypeScript imports no unreplaced JS/JSX module;
- the superseded JS/JSX implementation and tests are deleted;
- package scripts, Docker, CI, aliases, and consumers point only to the new path;
- an automated guard proves the named old files are absent; and
- `status/METRICS.md` records lines/files added and removed.

Unreplaced JS/JSX may remain in the repository only as unreachable backlog. It
is not a fallback, compatibility path, test gate, or supported runtime.

Generated/vendor JavaScript is not hand-converted. It is classified explicitly,
removed from source control when appropriate, or regenerated from TypeScript by
its owning build task.

## 8. Behavior And Data Guard

Source compatibility is intentionally not preserved. These constraints remain:

- stable supported `/v1` behavior and error semantics unless the approved
  contract explicitly changes them before client release;
- forward-only PostgreSQL evolution until the final reviewed baseline;
- transactional, locking, idempotency, retention, and audit invariants;
- safe auth, authorization, CSRF, CORS, rate limits, provider signatures, and
  secret/PII redaction;
- provider and financial evidence is never destructively rolled back; and
- incomplete runtime artifacts remain non-release until the owning gates pass.

Intentional behavior changes must be listed in the task log and
`decisions/RISKS_AND_DECISIONS.md`.

## 9. Validation Matrix

Every packet runs its focused tests plus the applicable surface gates:

| Surface | Minimum gates |
|---|---|
| Contracts | strict typecheck, typed lint, unit/JSON-schema tests, 80% all metrics, build, root/subpath import smoke |
| Backend runtime | strict typecheck, typed lint, unit/integration tests, 80% all metrics, source CLI smoke, emitted CLI smoke, Docker build/start/health when image-affecting |
| PostgreSQL | clean and existing-db migration, repository integration, constraints, concurrency/locking, rollback/forward-fix evidence |
| Frontend package | typecheck, lint, unit/component tests, 80% all metrics, production build, critical interaction smoke |
| Landing/BFF | typecheck, lint, unit/integration tests, production standalone build, backend proxy smoke, image smoke |
| Android | web build/sync, native build, platform/security tests, critical E2E, signed-artifact checks when release-facing |
| Release/CI | shell/config tests, build graph, image/health/readiness smoke, secret scan, rollback rehearsal where applicable |

Security-sensitive, data, provider, filesystem, auth, and financial changes also
require security review. Code changes always require code/TypeScript review.

## 10. Migration Evidence Boundary

Session 1 records only migration task packets, source/deletion boundaries,
validation, reviews, metrics, decisions, and resume checkpoints. Do not add
unrelated tooling implementation records to this session.

## 11. Durable Logging Model

Every task packet gets `logs/<TASK_ID>-<short-name>.md` containing:

- objective and closure;
- atomic units;
- files added/modified/deleted;
- RED and GREEN evidence;
- research/reuse notes;
- decisions and intentional behavior changes;
- security/code review findings and resolution;
- risks and rollback shape;
- exact validation commands/results;
- metrics; and
- commit/push plus next resume point.

Session-wide records updated after every landed packet, not every transient
execution event:

- `status/CURRENT.md` — one-page resume point;
- `TASKS.md` — packet states and next ready work;
- `status/IMPLEMENTATION_PROGRESS.md` — milestone summaries;
- `status/VALIDATION_SUMMARY.md` — durable validation evidence;
- `decisions/RISKS_AND_DECISIONS.md` — binding decisions/open risks;
- `status/METRICS.md` — production/test/tooling additions and removals.

Completed task logs are immutable except for correcting factual mistakes. New
facts go in the next task log; do not rewrite history to make a later design
look inevitable.

## 12. Resume Protocol

A new session resumes by reading, in order:

1. `README.md`;
2. `status/CURRENT.md`;
3. the active workstream row and packet file;
4. the active task log as non-normative execution evidence;
5. relevant risks, plan, and specification sections;
6. `git status --short`, `git log -5 --oneline`, and the last validation record.

Before changing code, confirm that the recorded commit matches `HEAD`, no
unexplained worktree changes overlap the task, and the listed old-file deletion
targets still exist. If interrupted, update the active log with the last command,
result, files in progress, and exact next action before yielding whenever
possible.

## 13. Version-Control Checkpoint

A packet lands only after:

1. all applicable checks pass in the approved runtime;
2. no CRITICAL/HIGH review finding remains;
3. documentation and metrics match the actual diff;
4. `git diff --check` and documentation-link checks pass;
5. the `resources/sessions/Legacy` tree matches its pre-task hash;
6. a conventional commit is created; and
7. the commit is pushed.

The next packet begins only after the prior checkpoint is recoverable from Git.


## Related notes (Obsidian graph)

- Design authority: [[plans/01-postgresql-typescript-rearchitecture-plan|Master rearchitecture plan]] · [[specifications/02-product-architecture-decisions|02 · Product & architecture]] · [[specifications/03-schema-lifecycle-specification|03 · Schema & lifecycle]] · [[specifications/04-api-security-test-specification|04 · API/security/email/test]] · [[specifications/05-system-tooling-diagrams|05 · System/tooling/contracts]]
- Binding decisions: [[decisions/RISKS_AND_DECISIONS|Risks & decisions]]
- Execution: [[TASKS|Task ledger]] · [[logs/README|Task-log index]] · [[status/CURRENT|Current resume point]]
- Templates: [[templates/PHASE_LOG_TEMPLATE|Phase-log template]] · [[templates/TASK_PACKET_TEMPLATE|Task-packet template]]
- Home: [[README|Session 1 home]]
