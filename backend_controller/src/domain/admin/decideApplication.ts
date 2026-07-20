/**
 * Decide an application (spec 04 §3.2). Both outcomes require `in_review`, a
 * verified email, the If-Match version, and no prior decision.
 *
 * Approval atomically creates exactly one invited user, activation invite,
 * review, audit event, activation outbox event, and activation delivery.
 * Rejection atomically creates the review, audit event, rejection outbox event,
 * and a token-free rejection delivery, and creates no user, credential, or
 * invite. Onboarding decisions use no maker-checker.
 */
import type {
  ActivationInvite,
  Application,
  ApplicationReview,
  EmailDelivery,
  Transaction,
  User,
} from "../../db/repositories.js"
import type { CryptoContext } from "../../crypto/context.js"
import { AppError } from "../../http/errorCatalog.js"
import type { ApplicationWriteRepository } from "../../repositories/applicationRepository.js"
import type { ApplicationReviewWriteRepository } from "../../repositories/applicationReviewRepository.js"
import type { AuditWriteRepository } from "../../repositories/auditRepository.js"
import type { EmailDeliveryWriteRepository } from "../../repositories/emailDeliveryRepository.js"
import type { OutboxWriteRepository } from "../../repositories/outboxRepository.js"
import type { UserWriteRepository } from "../../repositories/userRepository.js"
import type { ActivationInviteWriteRepository } from "../../repositories/activationInviteRepository.js"

export interface DecideApplicationConfig {
  readonly activationInviteTtlMs: number
  readonly sesConfigurationSet: string
}

export interface DecideApplicationDeps {
  readonly applicationRepository: ApplicationWriteRepository
  readonly applicationReviewRepository: ApplicationReviewWriteRepository
  readonly userRepository: UserWriteRepository
  readonly activationInviteRepository: ActivationInviteWriteRepository
  readonly outboxRepository: OutboxWriteRepository
  readonly emailDeliveryRepository: EmailDeliveryWriteRepository
  readonly auditRepository: AuditWriteRepository
  readonly crypto: CryptoContext
  readonly clock: () => Date
  readonly config: DecideApplicationConfig
}

export interface DecideApplicationInput {
  readonly applicationId: string
  readonly reviewerUserId: string
  readonly decision: "approved" | "rejected"
  readonly reasonCode: string
  readonly reasonDetail: string | null
  readonly expectedVersion: number
  readonly requestId: string
  readonly idempotencyKey: string
}

export interface DecideApplicationResult {
  readonly application: Application
  readonly review: ApplicationReview
  readonly user: User | null
  readonly activationInvite: ActivationInvite | null
  readonly emailDelivery: EmailDelivery
}

export const decideApplication = async (
  tx: Transaction,
  deps: DecideApplicationDeps,
  input: DecideApplicationInput,
): Promise<DecideApplicationResult> => {
  const application = await deps.applicationRepository.lockById(tx, input.applicationId)
  if (application === null) throw new AppError("RESOURCE_NOT_FOUND")
  if (Number(application.version) !== input.expectedVersion) throw new AppError("STATE_CONFLICT")
  if (application.state !== "in_review") throw new AppError("STATE_CONFLICT")
  if (application.email_verified_at === null) throw new AppError("STATE_CONFLICT")

  const now = deps.clock()
  const decided = await deps.applicationRepository.applyDecision(tx, {
    applicationId: input.applicationId,
    decision: input.decision,
    now,
  })
  if (decided === null) throw new AppError("STATE_CONFLICT")

  const review = await deps.applicationReviewRepository.insert(tx, {
    applicationId: input.applicationId,
    reviewerUserId: input.reviewerUserId,
    decision: input.decision,
    reasonCode: input.reasonCode,
    reasonDetail: input.reasonDetail,
    requestId: input.requestId,
    idempotencyKey: input.idempotencyKey,
  })

  const recipient = application.email_normalized
  const envelope = deps.crypto.encryptRecipient(recipient)
  const recipientEvidence = {
    recipientCiphertext: envelope.ciphertext,
    recipientNonce: envelope.nonce,
    recipientHmac: deps.crypto.hmacRecipient(recipient).hash,
    recipientMasked: deps.crypto.maskEmail(recipient),
    recipientEncryptionKeyVersion: envelope.keyVersion,
    suppressionHmacKeyVersion: deps.crypto.suppressionHmacKeyVersion,
    sesConfigurationSet: deps.config.sesConfigurationSet,
    templateVersion: "v1",
  }

  if (input.decision === "approved") {
    const user = await deps.userRepository.createInvited(tx, {
      applicationId: input.applicationId,
      emailNormalized: application.email_normalized,
      phoneE164: application.phone_e164,
      fullName: application.full_name,
    })
    const token = deps.crypto.generateVerificationToken()
    const invite = await deps.activationInviteRepository.create(tx, {
      userId: user.id,
      applicationId: input.applicationId,
      tokenHash: token.hash,
      tokenKeyVersion: token.keyVersion,
      expiresAt: new Date(now.getTime() + deps.config.activationInviteTtlMs),
      createdByUserId: input.reviewerUserId,
    })
    const outbox = await deps.outboxRepository.enqueue(tx, {
      topic: "email",
      eventType: "user.activation_invited",
      eventVersion: 1,
      aggregateType: "user",
      aggregateId: user.id,
      requestId: input.requestId,
      deduplicationKey: `activation_invite:${token.hash.toString("hex")}`,
      payload: { template: "activation_invite", activationToken: token.token },
    })
    const emailDelivery = await deps.emailDeliveryRepository.createActivationInviteDelivery(tx, {
      outboxEventId: outbox.id,
      userId: user.id,
      applicationId: input.applicationId,
      activationInviteId: invite.id,
      ...recipientEvidence,
    })
    await deps.auditRepository.append(tx, {
      actorType: "admin",
      actorUserId: input.reviewerUserId,
      command: "application.decide",
      entityType: "application",
      entityId: input.applicationId,
      fromState: "in_review",
      toState: "approved",
      requestId: input.requestId,
      entityVersion: Number(decided.version),
      metadata: { decision: "approved", reasonCode: input.reasonCode },
    })
    return { application: decided, review, user, activationInvite: invite, emailDelivery }
  }

  const outbox = await deps.outboxRepository.enqueue(tx, {
    topic: "email",
    eventType: "application.rejected",
    eventVersion: 1,
    aggregateType: "application",
    aggregateId: input.applicationId,
    requestId: input.requestId,
    deduplicationKey: `application_rejected:${input.applicationId}`,
    payload: { template: "application_rejected" },
  })
  const emailDelivery = await deps.emailDeliveryRepository.createRejectionDelivery(tx, {
    outboxEventId: outbox.id,
    applicationId: input.applicationId,
    ...recipientEvidence,
  })
  await deps.auditRepository.append(tx, {
    actorType: "admin",
    actorUserId: input.reviewerUserId,
    command: "application.decide",
    entityType: "application",
    entityId: input.applicationId,
    fromState: "in_review",
    toState: "rejected",
    requestId: input.requestId,
    entityVersion: Number(decided.version),
    metadata: { decision: "rejected", reasonCode: input.reasonCode },
  })
  return { application: decided, review, user: null, activationInvite: null, emailDelivery }
}
