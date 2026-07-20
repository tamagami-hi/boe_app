# Task Log Index

Task logs are append-only execution evidence governed by
[WORKING_MODEL.md](../WORKING_MODEL.md). Create each new log from the phase-log
template before production implementation starts.

| Task | Status | Log | Commit |
|---|---|---|---|
| BE-001 | DONE | [Backend TypeScript runtime reset](./BE-001-backend-runtime-reset.md) | `9e884ad` |
| DOC-001 | REVIEW | [Session working model and reorganization](./DOC-001-session-working-model.md) | Pending containing docs commit |
| BE-002 | DONE | [Graceful API lifecycle](./BE-002-graceful-api-lifecycle.md) | on `dev` |

Completed logs preserve their evidence. Correct factual errors explicitly; do
not rewrite prior RED/GREEN history to match later architecture.
