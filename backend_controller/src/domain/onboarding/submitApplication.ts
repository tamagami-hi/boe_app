/**
 * Public application submission command (spec 04 §3.1). Runs inside a
 * caller-owned transaction and produces a uniform outcome: a new identifier pair
 * atomically creates the application, authoritative consent evidence, a
 * verification token (hash only), an email delivery, an outbox trigger, and an
 * audit event; any active-identity conflict is a no-op so the public response
 * never reveals a duplicate.
 *
 * Deferred to BE-008b-3: the duplicate-pending 15-minute cooldown resend, the
 * cross-match security metric, and savepoint handling for the rare concurrent
 * uniqueness race (currently a retryable failure). Deferred to BE-012: hardening
 * the transient raw token carried in the outbox payload and actual SES sending.
 */
import type { CryptoContext } from "../../crypto/context.js"
import type { Transaction } from "../../db/repositories.js"
import { AppError } from "../../http/errorCatalog.js"
import type { ApplicationWriteRepository } from "../../repositories/applicationRepository.js"
import type { AuditWriteRepository } from "../../repositories/auditRepository.js"
import type { ConsentRepositoryImpl } from "../../repositories/consentRepository.js"
import type { EmailDeliveryWriteRepository } from "../../repositories/emailDeliveryRepository.js"
import type { OutboxWriteRepository } from "../../repositories/outboxRepository.js"
import type { VerificationTokenWriteRepository } from "../../repositories/verificationTokenRepository.js"

export interface SubmitApplicationConfig {
  readonly verificationTokenTtlMs: number
  readonly sesConfigurationSet: string
}

export interface SubmitApplicationDeps {
  readonly applicationRepository: ApplicationWriteRepository
  readonly consentRepository: ConsentRepositoryImpl
  readonly verificationTokenRepository: VerificationTokenWriteRepository
  readonly emailDeliveryRepository: EmailDeliveryWriteRepository
  readonly outboxRepository: OutboxWriteRepository
  readonly auditRepository: AuditWriteRepository
  readonly crypto: CryptoContext
  readonly clock: () => Date
  readonly config: SubmitApplicationConfig
}

export interface SubmitApplicationInput {
  readonly fullName: string
  readonly emailNormalized: string
  readonly phoneE164: string
  readonly consents: readonly { readonly kind: "terms" | "privacy"; readonly version: string }[]
  readonly requestId: string
  readonly clientIp: string
  readonly userAgent: string | null
}

const MAX_USER_AGENT_LENGTH = 512

const truncateUserAgent = (userAgent: string | null): string | null => {
  if (userAgent === null) return null
  const stripped = userAgent.replace(/[\u0000-\u001f\u007f-\u009f]/gu, "")
  const trimmed = stripped.trim()
  if (trimmed === "") return null
  return trimmed.slice(0, MAX_USER_AGENT_LENGTH)
}

/** Execute the submission. Always resolves; the caller returns 202 regardless. */
export const submitApplication = async (
  tx: Transaction,
  deps: SubmitApplicationDeps,
  input: SubmitApplicationInput,
): Promise<void> => {
  // Resolve consents against the authoritative current documents.
  const currentDocuments = await deps.consentRepository.findCurrentDocuments(tx, ["terms", "privacy"])
  const documentByKind = new Map(currentDocuments.map((document) => [document.kind, document]))

  const resolvedDocumentIds: string[] = []
  for (const consent of input.consents) {
    const document = documentByKind.get(consent.kind)
    if (document === undefined || document.version !== consent.version) {
      throw new AppError("VALIDATION_FAILED", {
        fields: { consents: [`stale or unknown ${consent.kind} consent version`] },
      })
    }
    resolvedDocumentIds.push(document.id)
  }

  // Any active application or existing user with this email/phone is a no-op.
  const hasConflict = await deps.applicationRepository.hasActiveConflict(tx, {
    emailNormalized: input.emailNormalized,
    phoneE164: input.phoneE164,
  })
  if (hasConflict) return

  const now = deps.clock()
  const application = await deps.applicationRepository.createSubmission(tx, {
    emailNormalized: input.emailNormalized,
    phoneE164: input.phoneE164,
    fullName: input.fullName,
  })

  const consentIp = deps.crypto.hmacConsentIp(input.clientIp)
  await deps.consentRepository.recordAcceptances(tx, {
    applicationId: application.id,
    consentDocumentIds: resolvedDocumentIds,
    acceptedAt: now,
    ipHmac: consentIp.hash,
    ipHmacKeyVersion: consentIp.keyVersion,
    userAgent: truncateUserAgent(input.userAgent),
  })

  const token = deps.crypto.generateVerificationToken()
  const verificationToken = await deps.verificationTokenRepository.create(tx, {
    applicationId: application.id,
    tokenHash: token.hash,
    tokenKeyVersion: token.keyVersion,
    expiresAt: new Date(now.getTime() + deps.config.verificationTokenTtlMs),
  })

  const outboxEvent = await deps.outboxRepository.enqueue(tx, {
    topic: "email",
    eventType: "application.verification_requested",
    eventVersion: 1,
    aggregateType: "application",
    aggregateId: application.id,
    requestId: input.requestId,
    deduplicationKey: `verify_email:${token.hash.toString("hex")}`,
    // The raw token is transient transport for the worker; BE-012 hardens it.
    payload: { template: "verify_email", verificationToken: token.token },
  })

  const recipientEnvelope = deps.crypto.encryptRecipient(input.emailNormalized)
  const recipientHmac = deps.crypto.hmacRecipient(input.emailNormalized)
  await deps.emailDeliveryRepository.create(tx, {
    outboxEventId: outboxEvent.id,
    applicationId: application.id,
    verificationTokenId: verificationToken.id,
    templateKey: "verify_email",
    templateVersion: "v1",
    recipientCiphertext: recipientEnvelope.ciphertext,
    recipientNonce: recipientEnvelope.nonce,
    recipientHmac: recipientHmac.hash,
    recipientMasked: deps.crypto.maskEmail(input.emailNormalized),
    recipientEncryptionKeyVersion: recipientEnvelope.keyVersion,
    suppressionHmacKeyVersion: deps.crypto.suppressionHmacKeyVersion,
    sesConfigurationSet: deps.config.sesConfigurationSet,
  })

  await deps.auditRepository.append(tx, {
    actorType: "public",
    command: "application.submit",
    entityType: "application",
    entityId: application.id,
    toState: "pending_email_verification",
    requestId: input.requestId,
    entityVersion: 1,
    metadata: {},
  })
}
