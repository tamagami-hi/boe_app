# Coordinator Task Ledger

This ledger is exclusively for the `resources/_coord` engineering workstream.
It does not select, block, or record the BOE JavaScript-to-TypeScript migration;
that work remains in `resources/sessions/1/TASKS.md`.

| Task | Status | Packet | Log | Current boundary |
|---|---|---|---|---|
| COORD-001 Central coordination system | ACTIVE | [Packet](./packets/COORD-001-central-coordination-system.md) | [Log](./logs/COORD-001-central-coordination-system.md) | Central state/CLI implementation exists locally; branch coverage, tracked-ignore policy, fresh-clone checks, and formal reviews remain incomplete |

## Resume Order

1. [Coordinator handbook](./README.md)
2. [COORD-001 handoff](./handoffs/07-central-coordination-system-handoff.md)
3. The linked packet and phase log
4. `git status --short`, then the focused coordinator tests

The runtime state and old `agents/*.json` records are ephemeral. Do not add
them to this ledger or use them as durable migration evidence.
