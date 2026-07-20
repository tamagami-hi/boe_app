# COORD-001: Central Coordination System

- Status: `READY`
- Owner surface: `resources/_coord/**`, `.gitignore`, and the coordination/status
  records under `resources/sessions/1/**`
- Dependencies: `DOC-001` authority and file layout drafted; code checkpoint
  `9e884ad`
- Objective: replace the race-prone ignored advisory board with a tracked,
  centralized, atomic, dependency-aware coordination system for all project
  agents.
- Normative sources: user instructions; [migration working model](../../sessions/1/WORKING_MODEL.md);
  [coordination handoff](../handoffs/07-central-coordination-system-handoff.md);
  current `resources/_coord/coord.mjs`; Node filesystem semantics; reviewed
  lock-directory pattern from `moxystudio/node-proper-lockfile`.
- Dominant risk: a concurrency or stale-recovery bug authorizes two agents to
  edit overlapping paths or silently discards coordination state.
- Production replacement closure: central state schema, immutable transition
  core, atomic mutex/write protocol, dependency-aware task CLI, hierarchical
  claims, protected paths, stale recovery, audit history, JSON status, tracked
  project config/docs, and backward-compatible safe commands.
- Exact JS/JSX deletion target: none; this is coordination tooling, not an
  application migration packet.
- Capability eval: independent processes share one valid state and cannot obtain
  overlapping claims; agents can discover ready tasks, assignments, blockers,
  stale claims, history, and exact next actions from the CLI.
- Regression evals: passive `next` never blocks; stale claims require reclaim;
  dependency/packet gates fail closed; protected/traversal paths are rejected;
  failed transitions do not mutate state; source is tracked while live state is
  ignored.
- Security evals: symlink/path-alias containment, private permissions,
  administrator-only revision-checked reclaim, fencing-token invalidation,
  corrupt/oversized state failure, and crash-safe writes.
- Coverage/build/integration/E2E/image gates: Node unit/integration tests,
  repeated multi-process contention test, 80%+ coverage, CLI smoke from repo and
  another directory, corrupt-state recovery test, and Git ignore assertions.
- Required reviews: concurrency/code review, security review, documentation and
  resume-consistency review.
- Rollback shape: revert tracked coordinator/config/docs changes; ignored live
  state can be archived and the old per-agent JSON files remain available for
  inspection. Never auto-delete agent files during rollback.
- Done condition: tests and reviews pass; central protocol is documented; live
  state remains ignored; Session 1 status/log/evidence agree; Legacy hash is
  unchanged; conventional commit is pushed.
- Phase log: [COORD-001 log](../logs/COORD-001-central-coordination-system.md)
