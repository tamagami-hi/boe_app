# Live Multi-Agent Coordination With `resources/_coord`

## Scope And Current Status

This folder owns all coordination-system work: the coordinator source, policy,
tests, runtime state, task packets, logs, and handoffs. Its engineering records
are in `handoffs/`, `packets/`, and `logs/`; they do not belong to the BOE
JavaScript-to-TypeScript migration records in `resources/sessions/1`.

The separate coordination workstream status is in
[TASKS.md](./TASKS.md).

The central-coordinator replacement is currently in progress. Read
[COORD-001 handoff](./handoffs/07-central-coordination-system-handoff.md),
[packet](./packets/COORD-001-central-coordination-system.md), and
[log](./logs/COORD-001-central-coordination-system.md) before modifying it.

## Purpose

`resources/_coord/coord.mjs` replaces manual Markdown tracking of live agent
ownership. It is a file-based advisory board with no server:

- every agent writes only `resources/_coord/agents/<agent-id>.json`;
- global state is the union of all agent files at read time;
- claims use announce → short re-check → holding to tolerate races;
- heartbeat timestamps identify stale sessions; and
- the board reports double-held protocol violations.

Session 1 Markdown remains the durable layer for specifications, dependency
order, complete task packets, decisions, validation, metrics, completed logs,
and resume checkpoints. `_coord` owns ephemeral who/what-file/heartbeat state.

## Identity Setup

Use a stable unique ID for the entire terminal/agent session. Do not rely on the
fallback process-parent identity across separate invocations.

```bash
export COORD_AGENT=codex
export COORD_SESSION="$PPID"
node resources/_coord/coord.mjs init
```

The command prints the derived full ID. Pin it for later invocations:

```bash
export COORD_AGENT_ID=codex-<instance>
```

An orchestrator may assign `COORD_AGENT_ID` directly. Parallel agents must never
share an ID.

## Task Startup Protocol

The lead first selects a workstream with satisfied phase gates and a complete
packet under `packets/`. Each agent then registers live context:

```bash
node resources/_coord/coord.mjs brief "BE-003 runtime configuration: env boundary"
node resources/_coord/coord.mjs ref \
  resources/sessions/1/packets/BE-003-runtime-configuration.md \
  resources/sessions/1/specifications/05-system-tooling-diagrams.md
node resources/_coord/coord.mjs status
```

Use `next` only to advertise likely work. It is non-binding:

```bash
node resources/_coord/coord.mjs next backend_controller/src/config/env.js
```

## Exact-File Claim Protocol

Before editing, moving, creating, or deleting, claim every exact path:

```bash
node resources/_coord/coord.mjs claim \
  backend_controller/src/config/env.js \
  backend_controller/src/runtime/environment.ts \
  backend_controller/src/runtime/environment.test.ts
```

The claim exits `1` when another active holder blocks it or wins a simultaneous
race. Yield; do not edit the file. The current script compares exact normalized
strings only: claiming `backend_controller/src/config` does not block another
agent claiming `backend_controller/src/config/env.js`.

For moves, claim old and new paths. For deletion, claim the deleted path and any
guard/test updated to prove absence. For a new file, claim its planned path
before creation.

## While Working

Refresh liveness at least once each agent turn and before/after long validation:

```bash
node resources/_coord/coord.mjs heartbeat
node resources/_coord/coord.mjs status
```

Default staleness is 30 minutes (`COORD_STALE_MS`). Do not reclaim an active
agent. After the TTL and external confirmation that the session is abandoned:

```bash
node resources/_coord/coord.mjs reclaim <stale-agent-id>
```

## Completion, Cancellation, And Commit

After focused validation and handoff of the diff:

```bash
node resources/_coord/coord.mjs release <exact-path...>
```

`release` moves held paths to that agent's advisory `done` list. Use `drop` for
abandoned intent/holdings that did not land:

```bash
node resources/_coord/coord.mjs drop <exact-path...>
```

Before a shared commit, the lead runs `status`, confirms the commit's files are
not actively held by another agent, reviews the actual Git diff, runs task
acceptance, and updates durable Session 1 records once. `_coord` `done` never
means tests passed or code was committed.

## What Moves Out Of Markdown

Do not manually record these in Session 1 files:

- current agent identity or heartbeat;
- tentative per-agent file lists;
- who currently owns a file;
- claim conflicts/yields;
- stale session cleanup; or
- every atomic-unit completion.

Keep these durable in Session 1:

- workstream dependencies and phase gates;
- the complete task packet and deletion map;
- normative decisions/specifications;
- RED/GREEN, coverage, build, image, E2E, and review evidence;
- exact migration metrics and removed history;
- commit/push checkpoint and next authorized task.

This split prevents Markdown from becoming a stale lock board while preserving
the evidence needed to resume after `_coord` agents become stale or disappear.
