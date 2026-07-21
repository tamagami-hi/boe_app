# BE-013 Retire legacy public content/catalog

Status: DONE (deletion-only) — branch `ts-migration/backend` (PR #1). Accelerated
single-task mode.

## Scope correction (important)

The original plan framed BE-013 as "canonical public content/catalog + §4.2
schema." The authoritative API/security spec (04) contradicts that for the
current slice:

- Its OpenAPI route inventory is declared **exhaustive for the first slice**, and
  the only public content route is `GET /v1/public/consent-documents`.
- It states verbatim that courses, membership plans, FAQs, general content
  authoring, and financial routes **remain later slices**; only immutable
  terms/privacy consent documents are first-slice content.
- (`§4.2` in spec 04 is "Deployment key management", not content — the original
  task label was a misnomer.)

`GET /v1/public/consent-documents` is already served by
`routes/publicOnboardingRoutes.ts` (BE-008). Building a content/catalog schema
and public handlers now would contradict the first-slice spec, so BE-013 is
correctly a **deletion batch**. Canonical content/catalog (schema + routes) is a
later-slice task, tracked with GATE-07 / BE-017 / AD-006.

## Change

- Deleted `src/website/routes/publicRoutes.js` and
  `src/website/services/disclosureService.js`; registered both in
  `legacy-deletion.guard.test.ts`.
- Both were already dead: `publicRoutes.js` is imported only by the dead legacy
  `src/router.js` and itself imports the already-deleted `onboardingService.js`
  (removed in BE-008c), so it could not have loaded; `disclosureService.js` was
  imported only by `publicRoutes.js`. No TypeScript module referenced either.
- The dangling import left in `src/router.js` is harmless: `router.js` is dead
  legacy owned by BE-019 and is never loaded by the canonical `server.ts` /
  `createApplication`, so the build and smokes are unaffected (same pattern as the
  BE-010 auth-route and BE-011 health-route deletions).

## Verification

- `npm run check` green (typecheck + lint + unit coverage + build + source/dist
  smoke, including the extended deletion guard).
- `npm run test:integration` green (43/43; public content is out of scope for the
  first slice, so unaffected).
- Guards: `git diff --check` clean; Legacy tree hash `d5fd7425...` intact; backend
  authored JS **74 -> 72**; `package.json`/`package-lock.json` unchanged.
