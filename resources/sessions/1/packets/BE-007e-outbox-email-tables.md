# BE-007e: Outbox / Email Delivery Tables (child of BE-007)

- Status: `DONE`
- Owner surface: `backend_controller/db/migrations/**`, `test/integration/**`.
- Dependencies: BE-007d (`DONE`), BE-004/BE-005.
- Objective: add the additive canonical transactional-outbox and email delivery
  tables — proven on empty PostgreSQL 16.
- Normative sources: `specifications/03` §2.1 (enums `email_delivery_state`,
  `outbox_state`), §3.3 (`outbox_events`, `email_deliveries`,
  `email_provider_events`, `email_suppressions`).
- Dominant risk: incorrect outbox lease/claim invariants and email-delivery
  encryption-envelope / template-subject rules. Mitigation: integration test
  exercises outbox deduplication-key uniqueness + lease-field grouping, the
  template<->subject FK matrix, recipient-HMAC sizing + all-or-null PII
  envelopes, SNS message-id uniqueness + unmatched-correlation commit, and the
  suppression composite PK + lift grouping.
- Production replacement closure: `db/migrations/013_canonical_outbox_email.sql`
  (enums `outbox_state`, `email_delivery_state`; tables `outbox_events`,
  `email_deliveries`, `email_provider_events`, `email_suppressions`).
- Scope boundary / deferrals: Kysely repositories -> BE-007f; bootstrap seed ->
  BE-007g. The worker claim/lease state machine, backoff schedule, AES-256-GCM
  envelope operations, and SNS signature validation are command/worker-enforced;
  the DB here enforces the structural invariants only.
- Exact JS/JSX deletion target: none (additive).
- Capability eval: `013` applies on empty PG after `009`-`012`; a duplicate
  outbox deduplication key is rejected; outbox lease fields are permitted only in
  the transit states; a delivery with no subject / wrong template-FK combination
  is rejected; a non-32-byte recipient HMAC is rejected; a partially-nulled
  recipient envelope is rejected; a duplicate SNS message id is rejected while a
  valid-but-unknown correlation still commits; a suppression with a partial lift
  group is rejected.
- Coverage/build gates: unit `npm run check` green; `npm run test:integration`.
- Required reviews: general + security (outbox lease integrity, PII envelope
  all-or-null, suppression key isolation).
- Rollback shape: revert the BE-007e commit; remove `013`.
- Done condition: integration green; records updated; commit pushed; PR updated;
  Legacy hash `d5fd7425...`.
- Phase log: [BE-007e log](../logs/BE-007e-outbox-email-tables.md)
