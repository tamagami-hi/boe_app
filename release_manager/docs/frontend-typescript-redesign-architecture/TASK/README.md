# Task Logs

Developer-centric narrative, one file per task. Each answers: what was asked, what I actually did,
what I found that was not expected, what is verified versus not, and what the next developer needs
to know before touching it.

The append-only change record is [`../LOGS/implementation_log.md`](../LOGS/implementation_log.md).
Decisions are [`../LOGS/risk_and_decision.md`](../LOGS/risk_and_decision.md).

| # | Task | Status | Log entries |
|---|---|---|---|
| [001](001-architecture-investigation.md) | Forensic investigation and the 14-document architecture tree | Complete | 001 |
| [002](002-blocker-remediation.md) | Blockers B1, B2 (structural), B4, B7 | Complete | 002–005 |
| [003](003-phase0-amendment.md) | Phase 0 resequenced to per-phase contract extension | Complete | 006 |
| [004](004-phase1-foundation.md) | Phase 1 — `frontend_stack_ts` foundation | In progress | 007+ |
| [025](025-fluid-desktop-layout-and-admin-nav-completeness.md) | Fluid desktop layout, and admin navigation completeness | Complete, unverified on device | 035 |

## Conventions

- **Never modify `frontend_stack/`.** It is the legacy frontend, deleted only at Phase 12.
- **No comments in source files** (`rules.md` §1). Rationale goes in these logs and in the
  architecture docs.
- **No tests except for critical logic** (`README.md` §2–3): security, financial, authentication,
  authorization, data integrity.
- **State verification precisely** (`rules.md` §2). A green suite is not proof a feature works.
- Every log entry names its verification method: TESTED, STATIC, VPS, or UNVERIFIED with a handover
  command.
