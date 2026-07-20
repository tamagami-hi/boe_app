# BE-007b: Canonical Identity/Invite Tables (child of BE-007)

- Status: `DONE`
- Owner surface: `backend_controller/db/migrations/**`, `test/integration/**`.
- Dependencies: BE-007a (`DONE`), BE-004/BE-005.
- Objective: add the additive canonical identity tables `users`,
  `user_credentials`, `application_reviews`, `activation_invites`, and attach the
  deferred `verification_tokens.user_id` FK — proven on empty PostgreSQL 16.
- Normative sources: `specifications/03` §2.1/§2.2 (enums), §3.1/§3.2 (users,
  credentials, reviews, invites); `plans/01` Phase 3.
- Dominant risk: incorrect ownership/uniqueness constraints (identity
  uniqueness, composite invite ownership, credential lock invariants).
  Mitigation: integration test exercises unique email/phone, credential hash
  prefix + lock-window invariants, one-review-per-application, one-pending-invite
  composite ownership, and the new verification-token user FK.
- Production replacement closure: `db/migrations/010_canonical_identity.sql`
  (enums `user_account_state`, `activation_invite_state`, `application_decision`;
  tables `users`, `user_credentials`, `application_reviews`,
  `activation_invites`; `ALTER verification_tokens ADD FK user_id -> users`).
- Scope boundary / deferrals: `auth_sessions` + `auth_refresh_tokens` (the
  refresh/CSRF-rotation columns) go to **BE-007c**; RBAC/audit/idempotency/
  outbox/email to later children; repositories to BE-007e; typed bootstrap seed
  to BE-007f. Pragmatic DB checks continue (Zod enforces full field rules).
- Known risk (documented in RISKS_AND_DECISIONS): canonical `users` shares its
  name with the legacy `001` `users` table, so a full `migrate up` over the
  legacy chain would collide. Canonical migrations are validated in **isolation**
  (runner filtered to versions `>= 009`); there is no data and the legacy chain
  is archived at CLEAN-002. No environment runs the mixed chain.
- Exact JS/JSX deletion target: none (additive; identity/auth service JS deleted
  by BE-009/BE-010 once repositories + routes replace it).
- Capability eval: `010` applies on empty PG after `009`; unique user email/phone
  reject duplicates; a non-Argon2id credential hash and an inconsistent
  lock-window are rejected; only one review per application and one pending
  invite per user; a `password_reset` verification token with an unknown user is
  rejected by the new FK.
- Coverage/build gates: unit `npm run check` green; `npm run test:integration`.
- Required reviews: general + security (ownership FKs, credential invariants).
- Rollback shape: revert the BE-007b commit; remove `010`. No schema applied
  outside ephemeral test containers.
- Done condition: integration green; records updated; commit pushed; PR updated;
  Legacy hash `d5fd7425...`.
- Phase log: [BE-007b log](../logs/BE-007b-canonical-identity-tables.md)
