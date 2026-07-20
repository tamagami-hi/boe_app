# BE-021 Later-domain canonical schema — increment 1 (compliance/catalog/platform)

Status: DONE (increment 1 of 2) — branch `ts-migration/backend` (PR #1).

Introduces the first half of the spec-03 §4 canonical later-domain schema as
additive migrations on the `>= 009` baseline. Grounded in spec 03 §4 (not
speculative). No TypeScript consumers yet; Kysely `Database` types + repositories
land with the domain code.

## Migrations added

- `014_canonical_compliance.sql` (§4.1): `investor_profiles` (erasable AES-GCM
  PII envelopes), `kyc_cases` (one open case per user), `kyc_documents`,
  `kyc_reviews`, `risk_assessments` (one open per user; assessed requires
  score/category/timestamp). Enums `kyc_case_state`, `risk_assessment_state`,
  `risk_category`.
- `015_canonical_catalog.sql` (§4.2): `funds`, `fund_versions`,
  `fund_disclosure_versions`, `fund_nav_prices`, `fund_positions`,
  `fund_aum_snapshots`. Composite FKs keep a version's disclosure/NAV on the same
  fund; the `funds.current_published_version_id` pointer is a same-fund composite
  FK. Enums `fund_state`, `fund_risk_level`.
- `016_canonical_platform.sql` (§4.5): `finance_policy_versions` (single active;
  the only home for monetary approval thresholds), `marketing_leads` (erasable
  PII), `courses`, `membership_plans`, `app_config_versions`, `content_items`
  (FAQs are `content_items(kind='faq')` — no `faqs` table).

## Validation

- `test/integration/laterDomainSchema.integration.test.ts` (6 tests) applies the
  full baseline (009–016) — itself the primary DDL assertion — and checks: one
  open KYC case per user, assessed-risk completeness, a full fund publish chain
  (disclosure + NAV + version + current pointer), rejection of a cross-fund
  disclosure link (composite FK), single active finance policy, and one published
  content item per key.
- `npm run check` green; `npm run test:integration` green (69/69 across 8 files).
- Guards: whitespace clean; Legacy hash intact; backend authored JS still 0;
  `package.json`/lock unchanged.

## Next increment (BE-021 part 2)

The money-movement core — spec §4.3 investing/ownership (`mandates`, `sip_plans`,
`investment_orders`, `investment_executions`, `holdings`, `holding_lots`,
`holding_lot_movements`, `redemption_requests`) and §4.4 payments (`payments`,
`payment_attempts`, `provider_events`, `notifications`) — plus the Kysely types
for all later-domain tables. These carry the intricate cross-table ownership
composite FKs and money-math invariants and warrant their own carefully-tested
batch.
