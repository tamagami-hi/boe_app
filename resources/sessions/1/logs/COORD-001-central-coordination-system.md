# COORD-001 Phase Log: Central Coordination System

## Objective And Dependency Closure

- Objective: make `resources/_coord` the centralized live coordination authority
  for project agents while Session 1 remains the durable migration/evidence
  authority.
- Dependencies: DOC-001 draft model/layout and backend checkpoint `9e884ad`.
- Normative sources: task packet and central-coordination handoff.
- Dominant risk: lost state or overlapping path ownership under concurrency.
- Intentional behavior change: live coordination moves from the union of
  per-agent files to one atomic central state; passive intent no longer affects
  claim arbitration.

## Atomic Units

- [x] Inspect current coordinator and document known failures.
- [x] Complete GitHub/registry reuse research and select Node built-ins first.
- [x] Freeze the implementation boundary, invariants, CLI proposal, and tests in
  a pre-implementation handoff.
- [x] Write isolated failing tests for claims, tasks, stale recovery, state
  durability, protected paths, audit history, and JSON output.
- [x] Implement the immutable coordination core and atomic state store.
- [x] Implement/adapt the CLI and tracked project configuration.
- [ ] Correct the repository-root ignore policy, then prove source/tests are
  tracked while runtime state and old agent records remain ignored.
- [ ] Update central coordination documentation and Session 1 status.
- [ ] Run coverage, contention, CLI, security, code, and documentation reviews.
- [ ] Record metrics/evidence, commit, push, and update the resume point.

## Replacement And Deletion Map

| New/replaced tooling | Superseded behavior | Guard |
|---|---|---|
| `resources/_coord/lib/coord-core.mjs` | Per-agent union as authority | Atomic/revision/concurrency tests |
| `resources/_coord/coord.mjs` | Race-tolerant exact-string claim protocol | CLI compatibility and contention tests |
| `resources/_coord/project.json` | Untracked implicit project policy | Schema/protected-path tests |
| `resources/_coord/README.md` | Session-only operator instructions | Command/documentation consistency review |

No legacy agent JSON file is deleted by this packet.

## Research And Reuse

- Repository/GitHub search: inspected current coordinator and the maintained
  `moxystudio/node-proper-lockfile` lock-directory/stale-lock design.
- Primary documentation: Node filesystem/test-runner behavior is the required
  implementation authority.
- Registry/license/advisory check: npm reports `proper-lockfile` 4.1.2; no new
  dependency selected.
- Selected reuse/rejection: reuse the atomic lock-directory concept; implement
  the bounded state machine with Node built-ins to keep the tool self-contained.

## RED Evidence

- Command: `node --test resources/_coord/coord.test.mjs`
- Observed failure: `ERR_MODULE_NOT_FOUND` for
  `resources/_coord/lib/paths.mjs` before central core modules existed.
- Result: the intended initial failure was observed before implementation.

## Implementation And Decisions

- Changes currently present but uncommitted:
  - `coord.mjs` is a 381-line CLI for registration/session tokens, task
    create/ready/start/join/done, intent/claim/release/drop, heartbeat,
    reclaim, status/history/doctor/check, text output, and `--json` output.
  - `lib/config.mjs`, `errors.mjs`, `model.mjs`, `paths.mjs`, and `store.mjs`
    provide policy validation, immutable transitions, symlink-aware repository
    paths, hierarchical conflict checks, atomic lock-directory mutations,
    revisioned audit events, and private state persistence.
  - `coord.test.mjs` has 20 isolated Node tests (589 lines), including a
    three-agent same-path race, passive intent, stale reclaim fencing,
    task/dependency gates, path protection, symlink escape, corrupt/oversized
    state, stale mutex recovery, and command failure cases.
  - `project.json` holds central policy; `.gitignore` was changed to distinguish
    tracked source from live state, but the parent `resources/*` rule still
    prevents the source/test files from appearing as untracked.
- Error/security boundaries: fail closed on invalid identity, path, transition,
  schema, lock ownership, and corrupt state; never include secrets/file contents
  in events. Reclaim is administrator-only and rotates a fencing token; state
  paths are symlink-aware, private, flushed, and atomically renamed.
- Compatibility/data constraints: keep safe current command names; runtime state
  is local and ignored; Session 1 durable evidence remains tracked.

## GREEN Validation

| Gate | Command | Result |
|---|---|---|
| Focused tests | `node --test resources/_coord/coord.test.mjs` | Pass: 20/20 under Node 24.18.0 |
| Coverage | `node --test --experimental-test-coverage resources/_coord/coord.test.mjs` | Not accepted: 90.37% lines, 64.85% branches, 93.64% functions; add branch tests to reach 80% |
| Contention | Three-agent same-path process test | Pass: exactly one claim succeeds |
| CLI/ignore smoke | repo/external cwd plus `git check-ignore` assertions | Blocked: root `.gitignore:33` `resources/*` still ignores coordinator source/tests |
| Documentation/Legacy | link checker, `git diff --check`, Legacy hash | Pending |

## Reviews

- Code/concurrency: preliminary reviewer findings incorporated into design;
  formal post-implementation review pending coverage/ignore completion.
- Security: pending.
- Findings and regression-first fixes: pending.

## Metrics

- Production/tooling JS added/changed: 1,173 lines (`coord.mjs` plus five core
  modules), uncommitted and currently hidden by the root ignore policy.
- Test JS added/changed: 589 lines, uncommitted and currently hidden by the root
  ignore policy.
- Session documentation added/changed: this handoff, packet, and log checkpoint.
- Application production JS/JSX deleted: 0.
- Application test JS/JSX deleted: 0.

## Risk, Rollback, And Resume

- Residual risk: branch coverage is below the mandatory 80% threshold; the root
  ignore rule prevents the implementation from being committed; formal reviews
  and fresh-clone/CLI checks have not run.
- Rollback shape: revert the uncommitted `_coord`/ignore/docs changes. No
  application code or Legacy content was changed.
- Commit/push: pending.
- Exact next action: fix the root ignore exceptions, add tests for uncovered
  validation/CLI/store branches, then re-run coverage and required reviews.
