# 03 — Backend dead code

All removals **TESTED** by `backend_controller`'s `npm run check`: typecheck, lint, 804 tests
across 79 files, build, and both smoke entrypoints. See [09](09-verification-results.md).

## 1. The superseded port layer — the single largest reduction

`src/db/repositories.ts` went from **507 lines to 77**.

It declared 15 repository interfaces. **Fourteen had zero consumers** anywhere in `src/`,
`test/` or `scripts/`. Only `IdempotencyRepository` is live (32 references). The reason is
structural: every concrete repository in `src/repositories/*.ts` declares **its own** interface,
and the two sets do not even share method names —

| Dead port declaration | The live interface that replaced it |
| --------------------- | ---------------------------------- |
| `UserRepository.createFromApprovedApplication`, `.lockByNormalizedEmailWithCredential`, `.transitionAccount` | `UserWriteRepository.createActive`, `.findLoginIdentityByEmail`, `.findPasswordHash` |
| `AuthSessionRepository.create`, `.rotate`, `.revokeFamily` (14 methods) | `AuthSessionRepository` in `repositories/authSessionRepository.ts`, different shape |
| `OutboxRepository.enqueue/claimBatch/recordResult` | `repositories/outboxRepository.ts` |
| `EmailProviderEventRepository` (7 methods) | `repositories/emailProviderEventRepository.ts` |

Removed: `ApplicationRepository`, `ConsentRepository`, `ApplicationReviewRepository`,
`UserRepository`, `CredentialRepository`, `AuthSessionRepository`, `RbacRepository`,
`LegalHoldRepository`, `RetentionRepository`, `OutboxRepository`, `AuditRepository`,
`EmailDeliveryRepository`, `EmailProviderEventRepository`, `EmailSuppressionRepository`.

That orphaned **58 command and input types** which existed only as their parameters —
`CreateApplicationInput`, `WithdrawApplicationCommand`, `TransitionUserCommand`,
`ReplacePasswordCommand`, `CreateSessionInput`, `RotateRefreshTokenCommand`, `RotatedSession`,
`RotateCsrfCommand`, `ReplaceWebSessionCommand`, `ReplaceNativeSessionCommand`,
`RevokeSessionFamilyCommand`, `RevokeWebSessionCommand`, `RevokeNativeSessionCommand`,
`RevokeUserSessionsCommand`, `RetentionTarget`, `PlaceLegalHoldCommand`, `PlaceLegalHoldResult`,
`ReleaseLegalHoldCommand`, `NewOutboxEvent`, `ClaimOutboxBatchCommand`,
`RecordOutboxResultCommand`, `NewAuditEvent`, `CreateEmailDeliveryInput`,
`TransitionEmailDeliveryCommand`, `VerifiedSnsInboxInput`, `UpsertEmailSuppressionInput`,
`CleanupCandidate`, `CleanupCandidateQuery`, `CleanupRecordType`, `RetentionEntityType`,
`CursorInput`, `CursorPage`, `ApplicationQueueItem`, `ApplicationDetail`,
`ApplicationDeliverySummary`, `ApplicationConsentDetail`, `ActiveIdentityCollision`,
`EmailDeliveryQuery`, `CommandContext`, `ApplicationId`, `EmailDeliveryId`,
`DeliveryCorrelationId`, `PermissionCode`, and the row aliases
`ApplicationConsent`, `RolePermission`, `UserRole`, `LegalHold`, `FundDisclosureVersion`,
`FundAumSnapshot`, `AumGrowthBatch`, `FundStockDisclosure`, `ClientGrowthBatch`,
`ProviderEvent`, `ClientValueEntry`.

Plus **5 that were outright duplicates** of the authoritative versions:

| Removed from `db/repositories.ts` | Authoritative version kept |
| --------------------------------- | -------------------------- |
| `ApplicationQueueQuery` | `repositories/applicationRepository.ts:30` |
| `UserWithCredential` | `repositories/userRepository.ts:9` |
| `RevokeSessionsResult` | `repositories/authSessionRepository.ts:38` |
| `Role` (row alias) | no consumer at all |
| `Permission` (row alias) | no consumer at all |

`Brand` was briefly removed and immediately restored — `UserId = Brand<string, "UserId">` needs
it, and `UserId` has 45 references. The type-checker caught this within one iteration.

**What remains** in the file is exactly what is used: `Transaction`, `ReadonlyDeep`, `Row<>`, the
row aliases with real consumers, `UserId` / `Brand`, `ConsentKind`, `CreatedSession`,
`IdempotencyScope`, `CompleteIdempotencyInput` and `IdempotencyRepository`.

`investment-architecture.guard.test.ts:55` lists `db/repositories.ts` in its mandate-module
allowlist; the file still exists, so the guard is unaffected.

## 2. Repository methods with no production caller

Nine removed. Each was verified across `src/`, `test/` and `scripts/`.

| Method | File | Why it was safe |
| ------ | ---- | --------------- |
| `findContentItem` | `adminContentRepository.ts` | No reference anywhere; `lockContentItem` is the live read |
| `findUser` | `adminOversightRepository.ts` | Superseded by `userDetail`, which runs the same `USER_COLUMNS`/`USER_JOINS` query plus more |
| `lockActiveBySid` | `authSessionRepository.ts` | No call site; the only other mention was the dead port declaration |
| `findOpenInstallment` | `orderRepository.ts` | Only a `vi.fn()` stub |
| `lockByIdUnscoped` | `sipPlanRepository.ts` | Only a `vi.fn()` stub |
| `findLatestAllWorkers` | `workerHeartbeatRepository.ts` | Only a stub that *throws* `"unexpected"` — the test asserts it is never called. `check-worker-health.ts:24` uses `findLatestByWorker`. Removing it also made the `sql` import unused |
| `findSetupAttemptForAdmin` | `mandatesRepository.ts` | Unscoped read, no caller, no test. Removing it also removes an unscoped-read footgun |
| `findCollectionAttemptForOwner` | `mandatesRepository.ts` | Owner-scoped read, no caller, **no test** — see §5 for why this went and its sibling stayed |
| `lockByEmailWithCredential` | `userRepository.ts` | **STALE**, explicitly superseded. Two doc comments said the locking variant "used to" hold `FOR UPDATE` across the Argon2id verification; `findLoginIdentityByEmail` + `findPasswordHash` replaced it. Both comments rewritten to describe the current design without naming a deleted symbol |

The two `vi.fn()` stubs in `sipScheduleWorker.test.ts` were **missed on the first pass** and found
only by the symbol sweep — the mock is cast `as unknown as`, so the type-checker never objected.

## 3. `createLogEmailSender`

`src/email/emailSender.ts`. The only outright-dead export in the whole `domain/http/auth/crypto/cache/email` sweep, and the most instructive.

Its own module comment recorded the defect that retired it:

> it resolves successfully — so `dispatchDueDeliveries` recorded the delivery as `sent` and
> settled the outbox event as `delivered` for a message that never left the process.

`createUnconfiguredEmailSender` replaced it and fails closed. Keeping a fail-open sender beside a
fail-closed one is a live re-regression hazard: one wrong wire in `composition.ts` and
`email_deliveries.state` stops meaning anything.

Removed, along with the now-unused `EmailSendLog` interface, and the two prose references were
rewritten.

**`test_e2e/onboarding-harness.test.mjs:50` already asserts its absence** —
`assert.doesNotMatch(source, /createLogEmailSender/u)` against `composition.ts`. That negative
guard is both the evidence the removal is safe and the reason the symbol still appears in a
repo-wide grep. It is deliberately kept; see [08](08-retained-and-uncertain.md).

## 4. The dead notify retry transition

Covered in [02](02-lifecycle-and-state-machines.md) §4. Summary: `NOTIFY_TRANSITIONS.failed → dispatching`
was declared, plumbed through two signatures, and never exercised. `failed` is now terminal, which
matches both the absence of any retry code and what F-001's new expiry path writes.

## 5. What was kept, and the line that decided it

Two structurally identical candidates went opposite ways, and the difference is the point.

**`mandatesRepository.findMandateForOwner` — KEPT.** Dead in production, but
`test/integration/mandatePersistence.integration.test.ts:149-156` asserts it returns `null` for a
foreign `userId`. That is a security contract: it is the owner-**scoped** half of a pair whose
unscoped sibling (`findMandateForAdmin`, 7 callers) is live. Deleting the safe variant and leaving
the unsafe one is the shape that invites a future unscoped read on a client route.

**`mandatesRepository.findCollectionAttemptForOwner` — REMOVED.** Equally dead, equally
owner-scoped, **no test**. No contract was asserted, so nothing counted as evidence for retention.

Also kept, per D-048's decision that the refund machinery stays whole:
`refundRepository.create`, `paymentsRepository.markPaymentRefundPending` and
`domain/payments/merchantIds.newMerchantRefundId`. All three are the missing *creation* path for a
feature whose other nine-tenths ship — a repository, a worker branch, a domain module, three admin
endpoints, a screen and a permission. Removing them would make that creation path harder to add
than it already is. Full reasoning in [08](08-retained-and-uncertain.md) §1.

## 6. Over-exported but live — not touched

The sweep surfaced ~30 symbols exported from a module and used only inside it: `isCheckoutLive`
and `isInFastWindow` (`reconciliationCadence.ts`), `parseCookies` (`webAuth.ts`),
`computeGrowthDelta` (`clientGrowth.ts`), `CURSOR_TTL_MS`, `INTERNAL_OUTCOME_TO_CODE`,
`zodFieldErrors`, `resolveRequestId`, `RETRY_DELAYS_MS`, and the rest.

These are **not dead** — they have real intra-file callers. Unexporting them is a visibility tidy
with no behavioural effect, and it would touch ~20 files for no correctness gain. Left alone
deliberately, recorded so a future sweep does not mistake them for the §2 class.

## 7. Impossible branches found and reported, not removed

- **`selectPaymentGateway` has one live outcome.** `composition.ts`: if the relay is unconfigured
  it returns `null`, otherwise it returns the relay gateway. No provider dispatch remains, so
  every `paymentGateway === null` guard downstream now means "relay unconfigured".
- **`PAYMENT_PROVIDER` is `z.literal("phonepe").default("phonepe")`** — a provider switch that
  cannot switch. Reported in [05](05-configuration-audit.md); removing it changes a public config
  surface.
- **`composition.ts` casts `serverConfig.payments.recurring.merchantId as string`** while
  `environment.ts` only requires `PHONEPE_MERCHANT_ID` when autopay is enabled, and the
  registration guard never consults `payments.autoPay.enabled`. A config with relay + PhonePe
  callback credentials + autopay disabled passes `null` through a `string` cast. **UNCERTAIN /
  latent**; needs a config-matrix decision, not a deletion.
- **`https://invalid.local/dashboard`** is supplied as a placeholder redirect when PhonePe is
  unconfigured. The routes reject earlier with `DEPENDENCY_UNAVAILABLE` whenever the recurring
  gateway is null, so it is unreachable — except in the narrow combination *relay configured,
  PhonePe not*, where it would be emitted as a real checkout redirect. Reported.
- **PhonePe webhook ingestion requires both** `payments.phonepe` (for the verifier) **and**
  `payments.relay` (for the gateway). A deployment configuring only the relay silently registers
  no webhook routes, and `createReadinessCheck` does not object. Reported.
