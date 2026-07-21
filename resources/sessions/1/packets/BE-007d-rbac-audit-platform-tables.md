# BE-007d: RBAC / Audit / Platform Tables (child of BE-007)

- Status: `DONE`
- Owner surface: `backend_controller/db/migrations/**`, `test/integration/**`.
- Dependencies: BE-007c (`DONE`), BE-004/BE-005.
- Objective: add the additive canonical RBAC, maker-checker, audit, and platform
  tables — proven on empty PostgreSQL 16.
- Normative sources: `specifications/03` §2.1/§2.2 (enums `approval_state`,
  `actor_type`), §3.3 (RBAC, approval_actions, audit_events,
  idempotency_records, rate_limit_windows, legal_holds); `02` §7 (maker-checker
  closed action set).
- Dominant risk: incorrect RBAC/maker-checker/hold invariants. Mitigation:
  integration test exercises role code format + active-grant uniqueness, the
  closed 8-code action_type set + maker<>checker, idempotency scope uniqueness,
  rate-limit count>0, and legal-hold allowlist + one-unreleased-per-entity.
- Production replacement closure: `db/migrations/012_canonical_rbac_platform.sql`
  (enums `approval_state`, `actor_type`; tables `roles`, `permissions`,
  `role_permissions`, `user_roles`, `approval_actions`, `audit_events`,
  `idempotency_records`, `rate_limit_windows`, `legal_holds`).
- Scope boundary / deferrals: outbox/email -> BE-007e; repositories -> BE-007f;
  bootstrap seed -> BE-007g. Append-only enforcement triggers/role grants are a
  later hardening step; the DB here enforces structural constraints.
- Exact JS/JSX deletion target: none (additive).
- Capability eval: `012` applies on empty PG after `009`-`011`; a non-snake-case
  role code, a second active role-permission grant, a maker==checker approval, an
  out-of-set `action_type`, a duplicate idempotency scope/key, a zero rate-limit
  count, and a non-allowlisted legal-hold entity are all rejected; only one
  unreleased hold per entity.
- Coverage/build gates: unit `npm run check` green; `npm run test:integration`.
- Required reviews: general + security (authorization/maker-checker/hold
  invariants).
- Rollback shape: revert the BE-007d commit; remove `012`.
- Done condition: integration green; records updated; commit pushed; PR updated;
  Legacy hash `d5fd7425...`.
- Phase log: [BE-007d log](../logs/BE-007d-rbac-audit-platform-tables.md)
