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
| `plans/` | Current proposals and handoffs |

Each code package has its own manifest and `npm run check`. Build contracts before
frontend checks. The full verification boundary and permission requirements are
defined in [RULES.md](RULES.md#verification-boundaries).

## Current documents

- [RULES.md](RULES.md): binding rules and work process.
- [CLAUDE.md](CLAUDE.md): architecture, current state, commands, and task map.
- [WORKFLOW.md](WORKFLOW.md): workspaces, integration, and operator release flow.
- [DEPLOY.md](DEPLOY.md): deployment/configuration reference, not permission to deploy.
- [App feature proposal](plans/app-onboarding-contact-investment-email.md): onboarding
  recovery, contacts, earlier investments, and email improvements; implementation
  remains paused pending explicit approval.
- [Prior implementation records](release_manager/docs/): topic-specific evidence;
  completed/dated records are historical, not standing rulebooks.
