# BE-007a: Canonical Public-Onboarding Schema (child of BE-007)

- Status: `DONE`
- Owner surface: `backend_controller/db/migrations/**`, `test/integration/**`.
- Dependencies: BE-004 (`DONE`, pool + migration runner), BE-005 (`DONE`).
- Parent: BE-007 (canonical identity/onboarding schema) — split into child
  packets per the working model; this is the first.
- Objective: add the additive canonical **public-onboarding** tables and enums
  (the data model for `POST /v1/applications` and email verification), proven by
  applying the migration on an empty PostgreSQL 16 and asserting its key
  constraints.
- Normative sources: `specifications/03` §2.1 (enums), §3.1 (applications,
  consent_documents, application_consents, verification_tokens); `plans/01`
  Phase 3; `specifications/02` §5 (additive alongside legacy; no data to
  preserve).
- Dominant risk: incorrect constraints/indexes that either reject valid
  submissions or allow duplicate active applications. Mitigation: integration
  test exercises unique-active partial indexes, reuse after rejection, format
  checks, the SHA-256 consent digest check, and the one-pending-token index.
- Production replacement closure: one additive migration
  `db/migrations/009_canonical_onboarding.sql` (enums `application_state`,
  `token_purpose`; tables `applications`, `consent_documents`,
  `application_consents`, `verification_tokens`). These names do not collide
  with the legacy chain (verified).
- Scope boundary / deferrals: the `users`-dependent tables (users,
  user_credentials, activation_invites, auth_sessions, auth_refresh_tokens,
  application_reviews) and RBAC/audit/idempotency/outbox/email are later BE-007
  child packets; `verification_tokens.user_id` is a plain nullable column here,
  gaining its `users` FK when that table lands. Repositories and the bootstrap
  seed are later child packets. The full-code-point/tombstone-format and full
  canonical public-path checks are enforced at the Zod boundary (existing
  contracts) and hardened later; the DB check uses pragmatic equivalents.
- Exact JS/JSX deletion target: none (schema is additive; onboarding service JS
  is deleted by BE-008 when the Fastify handlers replace it).
- Capability eval: `db/migrations/009` applies on an empty PostgreSQL 16 via the
  BE-005 runner; unique-active email/phone reject duplicates but allow reuse
  after `rejected`/`withdrawn`; invalid phone/consent digest are rejected; only
  one pending verification token per application is allowed.
- Coverage/build gates: unit `npm run check` stays green (no new TS runtime
  code); `npm run test:integration` proves the schema.
- Required reviews: general + security (constraint correctness, enumeration
  safety, no PII leakage in schema).
- Rollback shape: revert the BE-007a commit; the migration file is removed. No
  schema applied outside ephemeral test containers.
- Done condition: integration green; records updated; commit pushed to
  `ts-migration/backend`; PR updated; Legacy hash `d5fd7425...`.
- Phase log: [BE-007a log](../logs/BE-007a-canonical-onboarding-schema.md)
