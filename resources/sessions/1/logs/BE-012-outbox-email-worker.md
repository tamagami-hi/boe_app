# BE-012 SES/SNS outbox delivery worker + signed provider-event ingress

Status: DONE (canonical core) — branch `ts-migration/backend` (PR #1). Accelerated
single-task mode. This is a highly-critical batch (envelope crypto, RSA signature
verification, webhook provenance, money-adjacent delivery state machine), so it
carries a real test suite: 57 unit tests over the pure logic and 8 integration
tests over the DB-bound worker and SNS route.

## Important scope note

BE-012 deletes **no** legacy JavaScript. The legacy application never had an SES
outbox worker or an SNS ingress; this batch is purely additive canonical
infrastructure the redesign requires. Payment-webhook JS
(`shared/routes/webhookRoutes.js`, `shared/services/webhookService.js`) is owned by
BE-014. Backend authored JS therefore stays at **74**; the zero-JS trajectory is
driven by the later domain batches (BE-013..BE-019).

## Change

Pure, unit-tested (`src/email/`):
- `retrySchedule.ts` — ladder 1m/5m/15m/1h/4h/12h/24h, up to 20% deterministic
  HMAC-seeded jitter, 8-attempt cap, SES failure classification (throttling/
  timeout/connection/5xx retryable; validated 4xx/rendering permanent).
- `snsMessages.ts` — strict Zod outer SNS discriminated union + inner SES event
  schema, header cross-check, and event classification to evidence/suppression
  (permanent bounce and complaint suppress; transient bounce and delay do not).
- `snsProvenance.ts` — SigningCertURL hardening (HTTPS/443, no
  credentials/query/fragment, exact `sns.<region>.amazonaws.com` host and cert
  path), AWS canonical string (v1/v2), certificate validity, and RSA-SHA1/RSA-SHA256
  signature verification. Fail-closed combinator `verifySnsProvenance`.
- `ports.ts` — `SesEmailSender` and `CertificateFetcher` seams.

DB-bound (integration-tested):
- Extended `outboxRepository`: `claimDue` (FOR UPDATE SKIP LOCKED + lease),
  `markSending`, `settleDelivered`, `scheduleRetry`, `deadLetter`, `cancel`,
  `recoverExpiredLeases`.
- Extended `emailDeliveryRepository`: row locks, `transitionSending`,
  `recordSent`, `recordSendFailure`, `cancel`, monotonic `applyEvidence`.
- New `emailProviderEventRepository` (MessageId-unique inbox + finalize) and
  `emailSuppressionRepository` (findActive + idempotent suppress).
- `domain/email/dispatchDueDeliveries.ts` — the worker choreography: recover
  leases, claim, commit `sending` (point of no return), call SES outside any
  transaction, settle in a fresh transaction; cancel suppressed/obsolete work
  before sending.
- `domain/email/recordProviderEvent.ts` — dedup, match delivery (signed
  `boe_delivery_id` tag then recorded SES MessageId), add evidence + suppression.
- `routes/providerEventRoutes.ts` — `POST /v1/provider-events/aws-sns`, raw
  text/plain (256 KiB) parser, ordered provenance checks, empty 200 on success,
  uniform 401 `SNS_SIGNATURE_INVALID` on any provenance failure, 200 on duplicate.

## Verification

- `npm run check` green (typecheck + lint + unit coverage 91% aggregate, `src/email`
  99% + build + source/dist smoke).
- `npm run test:integration` green — 43/43 across 6 files; aggregate 96.2% stmts /
  80.75% branch over repositories/routes/domain.
- Guards: `git diff --check` clean; Legacy tree hash `d5fd7425...` intact; backend
  authored JS **74** (unchanged); `package.json`/`package-lock.json` unchanged
  (a `selfsigned` dev tool was installed to mint the test certificate fixture, then
  removed; the cert/key PEMs are embedded as static test fixtures).

## Deferred

- Concrete Amazon SES v2 sender adapter and the SSRF-hardened certificate-fetch
  adapter (both behind the ports here) — composed at production wiring alongside
  the BE-010/BE-011 running-server composition.
- At-rest encryption of provider-event payloads (schema permits null ciphertext;
  the required SHA-256 digest is retained now).
- SubscriptionConfirmation operator-bootstrap confirmation and the retention jobs.
