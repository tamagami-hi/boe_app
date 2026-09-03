# TASK

One file per pass, in the order they were done. Each is the developer-facing narrative: what was
looked at, what was found, what was decided, and what a reader should check next.

| # | Task | Outcome |
| - | ---- | ------- |
| [001](001-discovery-and-verification.md) | Discovery and verification | Five parallel subsystem sweeps, then every claim re-checked against source. Four claims disproved |
| [002](002-lifecycle-fixes.md) | Lifecycle fixes | Three non-terminating paths fixed, two reported. Five new tests |
| [003](003-backend-dead-code.md) | Backend dead code | A superseded port layer removed; `db/repositories.ts` 507 → 77 lines |
| [004](004-configuration.md) | Configuration | 12 settings removed, one silent name mismatch fixed, one guard added |
| [005](005-frontend-dead-code.md) | Frontend dead code | 24 exports, one dependency, one Android permission, 13 tokens; one dead subsystem uncovered |
| [006](006-tooling-and-docs.md) | Tooling and docs | The nginx rate-limit gap, the unwired readiness probe, `DEPLOY.md` rewritten |
| [007](007-final-sweep.md) | Final sweep | 60 symbols checked; three leftovers `tsc` could not see |
