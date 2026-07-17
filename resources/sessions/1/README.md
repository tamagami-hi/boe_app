# Session 1 Planning Index

This folder contains two kinds of documents. Keep the existing filenames stable:
the documents cross-reference one another and should not be moved or renamed
without updating every reference.

## Handoffs

1. [`00-database-typescript-rearchitecture-handoff.md`](./00-database-typescript-rearchitecture-handoff.md)
   - Original repository assessment, confirmed product direction, known defects,
     required planner deliverables, and initial open decisions.
2. [`06-planning-completion-handoff.md`](./06-planning-completion-handoff.md)
   - Current continuation point, unresolved planning blockers, recommended
     resolutions, and the exact gate before TypeScript implementation may start.

## Implementation Plans And Normative Specifications

1. [`01-postgresql-typescript-rearchitecture-plan.md`](./01-postgresql-typescript-rearchitecture-plan.md)
   - Master phased implementation plan and acceptance gates.
2. [`02-product-architecture-decisions.md`](./02-product-architecture-decisions.md)
   - Product requirements, architecture decisions, source ownership, worktree
     rules, migration sequencing, maker-checker policy, deployment, and rollback.
3. [`03-schema-lifecycle-specification.md`](./03-schema-lifecycle-specification.md)
   - Canonical PostgreSQL tables, constraints, retention, state machines,
     repository contracts, transactions, locking, and later-domain schema.
4. [`04-api-security-test-specification.md`](./04-api-security-test-specification.md)
   - API contracts, authentication transports, CSRF, sessions, SES/SNS,
     idempotency, rate limiting, security policy, testing, and review gates.
5. [`05-system-tooling-diagrams.md`](./05-system-tooling-diagrams.md)
   - System/container/component diagrams, ERD, TypeScript package layout,
     dependency research, build pipeline, generated contracts, and CI design.

## Current Status

- Product direction and most domain/schema/API decisions are documented.
- `PRODUCT.md` is reconciled with application-first persistence and public
  education-only wording.
- This canonical planning set is staged for tracking at `resources/sessions/1`
  in the primary checkout. Once this change is committed and merged/rebased,
  the existing `resources` sparse patterns materialize it read-only in the
  admin, client, and landing worktrees; the files are never copied into
  surface-owned paths.
- Phase 0 is **approved**. Independent contract/schema, security, and
  architecture gates completed with no CRITICAL or HIGH findings.
- The TypeScript foundation is a separate Phase 2 action and remains blocked
  until the user explicitly authorizes implementation work.
