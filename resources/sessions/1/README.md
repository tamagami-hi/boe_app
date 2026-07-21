# Session 1: PostgreSQL And TypeScript Rearchitecture

## Intent

This session exists to replace the complete authored backend and frontend
JavaScript/JSX codebase with production TypeScript/TSX and delete the superseded
legacy code as each dependency-closed replacement lands.

The migration is **not** a JS/TS compatibility exercise:

- the old JavaScript application does not need to keep running during migration;
- migrated packages use strict TypeScript with `allowJs:false`;
- a migrated behavior deletes its old JS/JSX production and tests in the same
  task packet;
- unreplaced JavaScript may remain only as unreachable, uncompiled backlog;
- no authoritative build, smoke test, or release path may fall back to it; and
- database forward-migration, security, evidence, and supported API/client
  compatibility rules still apply.

Do not modify, move, or reinterpret `resources/sessions/Legacy/**`. It is outside
this session's active authority.

## Resume Here

This folder is a self-contained **Obsidian vault** (`resources/sessions/1`). Open
it in Obsidian and use **Graph View** to see the workflow: planning handoffs feed
the plan and specifications, which the working model and decisions govern, which
the task ledger drives into per-task packets and phase logs, which roll up into
status. Nodes are colour-grouped by folder (design, ledger, packets, logs,
status, removed, inventory, templates). The [[#obsidian-graph-map|Obsidian graph
map]] below is the wiki-link entry point; the ordinary repository-relative links
in the rest of this page remain authoritative.

Read in this order:

1. [Current resume point](./status/CURRENT.md)
2. [BOE working model](./WORKING_MODEL.md)
3. [Executable workstream ledger](./TASKS.md)
4. The active [DOC-001 packet](./packets/DOC-001-session-working-model.md) and
   its non-normative [execution log](./logs/DOC-001-session-working-model.md)
5. Relevant risks, plan, and specification documents
6. [Migration inventory](./inventory/JS_TS_MIGRATION_LEDGER.md)

Latest verified code checkpoint: `9e884ad`. The TypeScript/Fastify liveness
runtime is complete and pushed. `DOC-001` is reorganizing and validating this
session. After it lands, `CON-006` is the next contract candidate and `BE-002`
is the next backend-runtime candidate. Neither is `READY` until its complete
packet is instantiated, and only one may become active with user authorization.

## Directory Map

### Execution Authority

- [WORKING_MODEL.md](./WORKING_MODEL.md) — task selection, eval-first/TDD,
  replacement/deletion, validation, logging, and resume rules.
- [TASKS.md](./TASKS.md) — workstream statuses, phase dependencies, deletion
  owners, and links to complete execution packets.
- [Current](./status/CURRENT.md) — one-page continuation point.
- [Implementation progress](./status/IMPLEMENTATION_PROGRESS.md) — completed
  milestone summaries.
- [Validation summary](./status/VALIDATION_SUMMARY.md) — durable check evidence.
- [Metrics](./status/METRICS.md) — TS additions and remaining/deleted JS counts.
- [Risks and decisions](./decisions/RISKS_AND_DECISIONS.md) — binding decisions
  and unresolved risks.

### Plans And Normative Specifications

- [Master rearchitecture plan](./plans/01-postgresql-typescript-rearchitecture-plan.md)
- [Product and architecture decisions](./specifications/02-product-architecture-decisions.md)
- [Schema and lifecycle specification](./specifications/03-schema-lifecycle-specification.md)
- [API, security, email, and test specification](./specifications/04-api-security-test-specification.md)
- [System, TypeScript, tooling, and contract architecture](./specifications/05-system-tooling-diagrams.md)

### Inventory, Logs, And Removed History

- [JS/TS migration inventory](./inventory/JS_TS_MIGRATION_LEDGER.md) — complete,
  non-overlapping authored backlog partition and counts.
- [Task log index](./logs/README.md), including the BE-001 runtime reset and
  active DOC-001 working-model logs
- [Removed mechanisms](./removed/README.md)
- [Phase log template](./templates/PHASE_LOG_TEMPLATE.md)
- [Task packet template](./templates/TASK_PACKET_TEMPLATE.md)

### Historical Handoffs

- [Original assessment/handoff](./handoffs/00-database-typescript-rearchitecture-handoff.md)
- [Planning-completion handoff](./handoffs/06-planning-completion-handoff.md)
- [Backend TS migration complete + later-domain schema handoff](./handoffs/07-backend-ts-migration-and-later-domain-handoff.md)

Historical handoffs preserve context and may contain sections explicitly marked
superseded. Normative precedence is working model → decisions → master
plan/specifications → complete task packet. Task logs are read early for resume
efficiency but are non-normative evidence and never override specifications.

## Current Measured State

- Contracts: 857 production TS lines and 1,641 test TS lines; 113 tests at 100%
  coverage.
- Backend migrated runtime: 209 production TS lines, 88 operational TS lines,
  271 test TS lines; 18 tests above all 80% coverage gates.
- Backend legacy backlog: 89 JS files / 12,600 lines.
- Other frontend authored backlog: 188 JS/JSX files / 20,480 lines, plus two
  surface-specific MJS configs/scripts; landing authored source is already TS.
- Global active JS-family backlog including four tooling/config MJS files:
  281 files / 33,176 lines.
- JS removed by this program so far: 164 production/operational lines and 47
  test lines, all in `BE-001`.

Exact partitions and reproduction commands are in the inventory and metrics
documents. Generated Android bundles are classified separately and are never
hand-converted.


## Obsidian Graph Map

This section is the Obsidian graph entry point for the Session 1 vault. It adds
explicit wiki links without replacing the ordinary Markdown links above, which
remain authoritative for repository use. Start here, then follow
[[status/CURRENT|the current resume point]].

### Execution authority

- [[WORKING_MODEL|Working model]]
- [[TASKS|Migration task ledger]]
- [[status/CURRENT|Current resume point]]
- [[status/IMPLEMENTATION_PROGRESS|Implementation progress]]
- [[status/VALIDATION_SUMMARY|Validation summary]]
- [[status/METRICS|Migration metrics]]
- [[decisions/RISKS_AND_DECISIONS|Risks and decisions]]

### Plan and specifications

- [[plans/01-postgresql-typescript-rearchitecture-plan|Master rearchitecture plan]]
- [[specifications/02-product-architecture-decisions|Product and architecture decisions]]
- [[specifications/03-schema-lifecycle-specification|Schema and lifecycle specification]]
- [[specifications/04-api-security-test-specification|API, security, email, and test specification]]
- [[specifications/05-system-tooling-diagrams|System, TypeScript, tooling, and contract architecture]]

### Task evidence

- [[packets/DOC-001-session-working-model|DOC-001 packet]]
- [[logs/DOC-001-session-working-model|DOC-001 log]]
- [[logs/BE-001-backend-runtime-reset|BE-001 runtime-reset log]]
- [[logs/README|Task-log index]] (links every phase log)

### Handoffs and migration history

- [[handoffs/00-database-typescript-rearchitecture-handoff|Original assessment handoff]]
- [[handoffs/06-planning-completion-handoff|Planning-completion handoff]]
- [[handoffs/07-backend-ts-migration-and-later-domain-handoff|Backend TS migration + later-domain handoff]]
- [[inventory/JS_TS_MIGRATION_LEDGER|JS/TS migration inventory]]
- [[removed/README|Removed-mechanism index]]
- [[removed/BE-001-javascript-server|BE-001 removed JavaScript server]]

### Reusable templates

- [[templates/PHASE_LOG_TEMPLATE|Phase-log template]]
- [[templates/TASK_PACKET_TEMPLATE|Task-packet template]]

`resources/sessions/Legacy/**` is deliberately excluded from this graph and from
all active-session links. It remains immutable historical material.
