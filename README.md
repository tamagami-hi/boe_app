# BeOnEdge app

This repository contains the authenticated investing app, admin console, backend,
and shared API contracts. The public education website at `beonedge.in` is a
separate application; its signup request reaches this API through `/api/newuser`.

## Mandatory starting point

Before inspecting, changing, testing, or committing this project, read this
`README.md` and the root [RULES.md](RULES.md) completely. Repeat that context load
at session start and after compaction.

**`RULES.md` is the single authoritative repository rulebook.** It contains the
comment/testing restrictions previously stored here, financial and operational
safety, the production data and compatibility policy, Git identity/workflow,
context preparation, and documentation/verification requirements. Agent entrypoints reference it;
they do not define competing policies.

## Repository layout

| Directory | Purpose |
| --- | --- |
| `backend_controller/` | Node/TypeScript Fastify API, PostgreSQL repositories, and workers |
| `frontend_stack_ts/` | React/Vite/Capacitor frontend with client and admin build targets |
| `packages/contracts/` | Zod operation descriptors and generated OpenAPI |
| `release_manager/` | Maintainer-operated release tooling and deployment documentation |
| `test_e2e/`, `emu/` | Runtime/browser and Android verification tooling |
| `plans/` | The active plan |
| `docs/` | tally records (`docs/records/`) and programme documents (`docs/<programme>/`) |

Each code package has its own manifest and `npm run check`. Build contracts before
frontend checks. The full verification boundary and permission requirements are
defined in [RULES.md](RULES.md#verification-boundaries).

To run checks without installing the pinned Node 24 on the host, prefix any command
with `tools/node24-container/run.sh` from inside a package folder, for example
`tools/node24-container/run.sh sh -c 'npm ci && npm run check'` from
`backend_controller/` (use the relative path to the script). It runs the pinned
Node 24.22.3 and npm 11.16.0 in a local Alpine image as your user, and passes the
Docker socket so `npm run test:integration` works. Dependencies installed this way
are container builds, so do not mix them with host `npm`.

`tools/node22-container/run.sh` (Node 22.20.0) stays only for checking a checkout of
the previous release, whose images still run Node 22 and are the rollback target.
It goes once a release after the Node 24 release has shipped and the maintainer no
longer needs Node 22 checks.

## Current documents

- [RULES.md](RULES.md): binding rules and work process.
- [CLAUDE.md](CLAUDE.md): architecture, current state, commands, and task map.
- [WORKFLOW.md](WORKFLOW.md): workspaces, integration, and operator release flow.
- [DEPLOY.md](DEPLOY.md): deployment/configuration reference, not permission to deploy.
- [Admin improvements plan](plans/admin-improvements.md): the active plan; its
  status line and section 8 say what is built and released.
- [UI overhaul](docs/ui-overhaul/): the UI overhaul programme's audits and plan.
- [Migration 071](release_manager/docs/migration-071-company-name.md): the company-name
  correction in the published legal documents and its read-only production pre-check.
- [Client erasure](release_manager/docs/client-erasure.md): the erase procedure, its
  read-only pre-flight queries and the migration notes; read it before an erase.
- [Completed records](release_manager/docs/Completed/): historical evidence, not
  standing rulebooks, including the
  [previous app feature plan](release_manager/docs/Completed/app-onboarding-contact-investment-email.md),
  the [existing-client implementation record](release_manager/docs/Completed/existing-client-impl/README.md)
  and the [September 2026 client UI briefs](release_manager/docs/Completed/client-ui-2026-09/).

Decisions, questions, progress, reviews and hand-offs are tally records in
[`docs/records/`](docs/records/), read through the tally tools; plans cite them by ID.
