/**
 * Public email-verification command (spec 04 §3.1). The token itself is the
 * idempotency boundary: the first valid use consumes it and moves the application
 * to `submitted` in one transaction; a replay is `TOKEN_ALREADY_USED` (409) and
 * an expired token is `TOKEN_EXPIRED` (410). The public response exposes no
 * application id or internal state.
 */
import type { CryptoContext } from "../../crypto/context.js"
import type { Transaction } from "../../db/repositories.js"
import { AppError } from "../../http/errorCatalog.js"
import type { ApplicationWriteRepository } from "../../repositories/applicationRepository.js"
import type { AuditWriteRepository } from "../../repositories/auditRepository.js"
import type { VerificationTokenWriteRepository } from "../../repositories/verificationTokenRepository.js"

export interface VerifyApplicationEmailDeps {
  readonly applicationRepository: ApplicationWriteRepository
  readonly verificationTokenRepository: VerificationTokenWriteRepository
  readonly auditRepository: AuditWriteRepository
  readonly crypto: CryptoContext
  readonly clock: () => Date
}

export interface VerifyApplicationEmailInput {
  readonly token: string
  readonly requestId: string
}

export const verifyApplicationEmail = async (
  tx: Transaction,
  deps: VerifyApplicationEmailDeps,
  input: VerifyApplicationEmailInput,
): Promise<void> => {
  const tokenHash = deps.crypto.hashToken(input.token).hash
  const record = await deps.verificationTokenRepository.lockByHash(tx, tokenHash)

  if (
    record === null ||
    record.purpose !== "application_email_verification" ||
    record.application_id === null ||
    record.revoked_at !== null
  ) {
    throw new AppError("TOKEN_INVALID")
  }
  if (record.consumed_at !== null) {
    throw new AppError("TOKEN_ALREADY_USED")
  }

  const now = deps.clock()
  if (new Date(record.expires_at).getTime() <= now.getTime()) {
    throw new AppError("TOKEN_EXPIRED")
  }

  await deps.verificationTokenRepository.consume(tx, { tokenId: record.id, consumedAt: now })
  const application = await deps.applicationRepository.markEmailVerified(tx, {
    applicationId: record.application_id,
    verifiedAt: now,
  })

  await deps.auditRepository.append(tx, {
    actorType: "public",
    command: "application.verify_email",
    entityType: "application",
    entityId: record.application_id,
    fromState: "pending_email_verification",
    toState: "submitted",
    requestId: input.requestId,
    entityVersion: Number(application.version),
    metadata: {},
  })
}
