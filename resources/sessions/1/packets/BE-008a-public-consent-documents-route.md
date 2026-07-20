# BE-008a: Public Consent-Documents Route (child of BE-008)

- Status: `DONE`
- Owner surface: `backend_controller/src/repositories/**`, `src/routes/**`,
  `test/integration/**`.
- Dependencies: BE-006 (boundary), BE-007 (schema + seed + §7 interfaces).
- Objective: the first canonical `/v1` route end-to-end — `GET
  /v1/public/consent-documents` — backed by the first real repository
  implementation (`ConsentRepository.findCurrentDocuments`), proven against
  PostgreSQL 16 through the typed Fastify app.
- Normative sources: `specifications/04` §3.1 (`GET /v1/public/consent-documents`
  response shape, one current published document per kind, `publicPath`/
  `contentMarkdown`/`sha256` authority).
- Dominant risk: returning stale/duplicate documents or a wrong digest.
  Mitigation: query filters to `retired_at IS NULL` (the partial unique index
  guarantees one current per kind) and returns the stored bytea digest as
  lowercase hex; an integration test seeds the catalog and asserts the response.
- Production replacement closure: `src/repositories/consentRepository.ts`
  (`findCurrentDocuments`), `src/routes/publicOnboardingRoutes.ts` (registrar).
- Scope boundary / deferrals: `POST /v1/applications` (BE-008b), verify-email +
  deletion of legacy `website/services/onboardingService.js` (BE-008c). The rest
  of `ConsentRepository` (`recordAcceptances`, `findForApplication`) lands in
  BE-008b.
- Exact JS/JSX deletion target: none (deletion lands in BE-008c once the full
  onboarding surface is replaced).
- Capability eval: on a migrated + seeded DB, the route returns 200 with a
  success envelope whose `items` contain exactly the current `terms` and
  `privacy` documents, each with its stored `publicPath`, `contentMarkdown`, and
  64-hex `sha256`.
- Coverage/build gates: unit `npm run check` green; `npm run test:integration`.
- Required reviews: general + security (no configuration/URL can define consent
  content; only the authoritative row is returned).
- Rollback shape: revert the BE-008a commit; remove the repository/route/test.
- Done condition: check + integration green; records updated; commit pushed; PR
  updated; Legacy hash `d5fd7425...`.
- Phase log: [BE-008a log](../logs/BE-008a-public-consent-documents-route.md)
