# BE-007c: Canonical Session Tables (child of BE-007)

- Status: `DONE`
- Owner surface: `backend_controller/db/migrations/**`, `test/integration/**`.
- Dependencies: BE-007b (`DONE`), BE-004/BE-005.
- Objective: add the additive canonical `auth_sessions` and `auth_refresh_tokens`
  tables (refresh/CSRF rotation state, device-scoped native sessions, refresh
  token family) — proven on empty PostgreSQL 16.
- Normative sources: `specifications/03` §2.1 (enums `session_channel`,
  `auth_session_state`), §3.2 (auth_sessions, auth_refresh_tokens).
- Dominant risk: incorrect session/refresh invariants (device uniqueness,
  refresh-token single-current, channel/CSRF null rules, cascade). Mitigation:
  integration test exercises one-active-native-session-per-device, one current
  refresh token per session, native-vs-web CSRF rules, and the composite
  cascade FK.
- Production replacement closure: `db/migrations/011_canonical_sessions.sql`
  (enums `session_channel`, `auth_session_state`; tables `auth_sessions`,
  `auth_refresh_tokens`).
- Scope boundary / deferrals: RBAC/audit/idempotency/rate-limit/legal-holds ->
  BE-007d; outbox/email -> BE-007e; repositories -> BE-007f; bootstrap seed ->
  BE-007g. Exact 30-second grace / rotation-id semantics are app-enforced; DB
  uses pragmatic all-null-or-all-present and channel checks.
- Exact JS/JSX deletion target: none (additive; auth service JS deleted by
  BE-009/BE-010).
- Capability eval: `011` applies on empty PG after `009`+`010`; a second active
  native session for the same user+device is rejected; a second current
  (unused/unrevoked) refresh token per session is rejected; a native session
  carrying CSRF fields and a web session missing CSRF are rejected; the
  `(session_id, user_id)` refresh FK cascades on session delete.
- Coverage/build gates: unit `npm run check` green; `npm run test:integration`.
- Required reviews: general + security (session/refresh invariants, cascade).
- Rollback shape: revert the BE-007c commit; remove `011`.
- Done condition: integration green; records updated; commit pushed; PR updated;
  Legacy hash `d5fd7425...`.
- Phase log: [BE-007c log](../logs/BE-007c-canonical-session-tables.md)
