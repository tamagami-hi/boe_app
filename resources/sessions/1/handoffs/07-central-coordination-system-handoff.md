# Central Coordination System Implementation Handoff

## Checkpoint

- Prepared: 2026-07-20 before implementation.
- Last verified code commit: `9e884ad` on `main`, pushed to `origin/main`.
- Current documentation task: `DOC-001` remains `ACTIVE` and uncommitted.
- Prepared implementation task: `COORD-001` is `READY`; no coordinator source,
  test, configuration, or ignore-rule change has been made for it yet.
- Safety boundary: `resources/sessions/Legacy/**` must remain byte-for-byte
  unchanged. Recorded tree hash:
  `d5fd7425d67bce6f52da178dbce9f5c27d0f36921d838115ccc9631755e93fee`.

## User Intent

Upgrade `resources/_coord` from a collection of advisory per-agent JSON files
into the centralized coordination system for this project. Session 1 Markdown
continues to hold durable specifications, task packets, test/review evidence,
metrics, decisions, and resume points. The coordinator owns live agents, tasks,
assignments, claims, heartbeats, conflict resolution, and an audit trail.

## Existing Implementation

`resources/_coord/coord.mjs` currently supports `init`, `brief`, `ref`, `next`,
`claim`, `release`, `drop`, `heartbeat`, `status`, `whoami`, and `reclaim`.
It derives global state by reading `resources/_coord/agents/*.json`. The entire
`resources/_coord/` directory is ignored by Git, so a fresh clone does not
receive the script or a project configuration.

The existing per-agent protocol is not sufficient as a central authority:

1. A claim check stores only one contender per exact path. In a three-agent
   race, a contender can be overwritten and more than one agent can commit the
   same holding.
2. `next` is documented as non-binding but participates in claim races.
3. Stale holdings are ignored by `claim`, although the documented protocol
   requires explicit stale reclamation.
4. Only exact path strings conflict. A directory claim does not conflict with
   a descendant file claim.
5. Task dependencies, readiness, assignments, protected paths, revisions, and
   durable event history are not represented.
6. The documentation says each agent writes only its own file, while `reclaim`
   intentionally writes another agent's file.

## Target Invariants

- One authoritative live state is updated by read-modify-write while holding an
  inter-process mutex.
- State writes use a same-directory temporary file and atomic rename.
- Each successful mutation increments a monotonic revision and appends an
  actor/action/result event without secrets or file contents.
- A path conflicts with the same path, any ancestor, and any descendant.
- `next` is visibility-only and can never block or win a claim.
- Active and stale holdings both block. Only explicit `reclaim` can clear a
  stale agent's claims. Reclaim requires administrator authority, rechecks the
  expected revision under the mutex, and rotates a lease epoch/fencing token so
  the reclaimed process cannot later renew or release its old claim.
- A task can start only when its declared dependencies are `DONE` and its
  packet exists; one agent has at most one active task.
- Claims are linked to an active task and cannot cross the task's declared
  owner boundary without an explicit task update.
- `resources/sessions/Legacy` is a protected path and cannot be claimed,
  released as completed work, or used as a task owner surface.
- Human-readable and `--json` status describe the same state.
- Invalid commands, schemas, paths, transitions, and state corruption fail
  closed with actionable messages and non-zero exit codes.
- Repository paths are containment-checked and symlink-aware. Existing targets
  use their canonical path; planned files canonicalize their nearest existing
  ancestor. Outside-root and traversal aliases are rejected before mutation.
- Runtime directories and files use private `0700`/`0600` permissions. State
  persistence rejects unsafe symlink targets, creates unique temporary files
  without following links, flushes the file and containing directory, and then
  renames atomically.
- Runtime state, lock directories, temporary files, and agent heartbeats stay
  ignored; coordinator source, tests, README/schema, and project configuration
  are tracked.

## Proposed Tracked And Runtime Files

Tracked implementation boundary:

- `resources/_coord/coord.mjs` — CLI adapter and backwards-compatible commands.
- `resources/_coord/lib/coord-core.mjs` — validation, transitions, locking,
  path-conflict logic, and immutable state updates.
- `resources/_coord/coord.test.mjs` — Node test-runner unit/integration tests.
- `resources/_coord/project.json` — schema version, repository root, protected
  paths, and safe defaults.
- `resources/_coord/README.md` — operator and agent command reference.
- `.gitignore` — unignore the tracked files and continue ignoring live state.

Ignored live boundary:

- `resources/_coord/state.json`
- `resources/_coord/state.lock/`
- `resources/_coord/*.tmp.*`
- `resources/_coord/agents/*.json` retained only as legacy import evidence until
  migration is explicitly completed.

The tests must set an isolated temporary `COORD_HOME` so they never mutate live
project coordination state.

## Planned CLI

Keep the current agent commands where their meaning remains safe:

```text
init, brief, ref, next, claim, release, drop, heartbeat,
status [--json], whoami [--json], reclaim <agent>
```

Add central task and diagnostic commands:

```text
task create <id> ...
task ready <id>
task start <id>
task join <id>
task done <id>
task list [--json]
history [--json]
doctor [--json]
```

Exact syntax may be reduced during implementation if a smaller interface proves
all required transitions. Do not add a daemon, database, network service, or
third-party runtime dependency unless a failing acceptance test demonstrates
that Node built-ins cannot satisfy the requirement.

## TDD Plan

Write the tests before changing production coordinator behavior. Required RED
cases:

1. Three simultaneous agents cannot double-hold one path.
2. A passive `next` entry does not block a claim.
3. A stale holding blocks until explicit authorized reclamation.
4. Directory, ancestor, and descendant claims conflict symmetrically.
5. Protected paths and path traversal are rejected.
6. A task cannot start before all dependencies are `DONE` or without its packet.
7. A claim without an active task is rejected.
8. Invalid task transitions leave the prior state and revision unchanged.
9. Concurrent successful mutations produce valid JSON, unique revisions, and
   complete audit events.
10. Human and JSON status expose agents, tasks, claims, stale state, and next
    actions without leaking environment values.
11. Corrupt or unsupported-schema state fails closed and remains recoverable.
12. Existing command names retain documented exit-code behavior where safe.
13. Reclaim invalidates the old lease token; a resumed stale process cannot
    heartbeat, release, or mutate its former task/claims.
14. Crash injection around temporary-write, flush, and rename leaves either the
    old valid revision or the new valid revision, never partial JSON.

Primary test command:

```bash
node --test resources/_coord/coord.test.mjs
```

Coverage must meet the project-wide 80% requirement using Node's supported
coverage mode or an already-approved repository tool; record statements,
branches, functions, and lines when the selected runner exposes them.

## Research Already Completed

- Repository implementation and current ignored-state behavior inspected.
- GitHub repository/code search inspected the maintained
  `moxystudio/node-proper-lockfile` approach. Its core reusable idea is an
  atomic lock-directory creation plus explicit stale-lock handling.
- npm registry currently reports `proper-lockfile` 4.1.2. No dependency is
  selected: the first implementation should use audited Node filesystem
  primitives because the scope is small and this avoids adding runtime supply
  chain surface.
- Host available for coordinator tests: Node `v24.18.0`, npm `11.16.0`.

## Review And Security Gates

- Concurrency review: no double claim under repeated multi-process contention.
- General/code review: no CRITICAL, HIGH, or unresolved MEDIUM findings.
- Security review: identity/path validation, traversal/symlink boundary,
  lock recovery, corrupt-state handling, event redaction, and protected paths.
- Documentation review: README, Session 1 coordination protocol, task status,
  log, and resume point agree with implemented commands.
- Repository checks: `git diff --check`, local Markdown links, no stale moved
  Session 1 paths, and unchanged Legacy hash.

## Exact Resume Sequence

```bash
cd /home/nethunter07/PROJECTS/boe_app
git status --short
git log -5 --oneline
sed -n '1,260p' resources/sessions/1/handoffs/07-central-coordination-system-handoff.md
sed -n '1,260p' resources/sessions/1/packets/COORD-001-central-coordination-system.md
sed -n '1,260p' resources/sessions/1/logs/COORD-001-central-coordination-system.md
sed -n '1,420p' resources/_coord/coord.mjs
```

Then run the planned tests to observe RED before editing production coordinator
code. Update this handoff only to correct facts; implementation evidence belongs
in the COORD-001 phase log.

## Implementation Checkpoint Added 2026-07-20

Implementation began after this pre-implementation handoff. The exact current
state is recorded in the [COORD-001 phase log](../logs/COORD-001-central-coordination-system.md)
and [current resume point](../status/CURRENT.md): 20 isolated tests pass,
including the three-agent contention test, but branch coverage is 64.85% and
the root `resources/*` ignore rule still hides the coordinator source/tests.
Do not treat the coordinator as accepted, complete, or commit-ready until those
two blockers, the fresh-clone check, and formal reviews are complete.
