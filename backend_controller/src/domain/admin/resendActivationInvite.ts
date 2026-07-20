/**
 * Resend an activation invite (spec 04 §3.2). Locks the user and current pending
 * invite, verifies the caller's expected invite id, revokes only that pending
 * invite, creates one replacement, and queues one activation delivery. A
 * concurrent resend loses the expected-invite comparison and is a STATE_CONFLICT.
 * The idempotency protocol replays a repeat instead of revoking again.
 */
import type { ActivationInvite, EmailDelivery, Transaction, UserId } from "../../db/repositories.js"
import type { CryptoContext } from "../../crypto/context.js"
import { AppError } from "../../http/errorCatalog.js"
import type { ActivationInviteWriteRepository } from "../../repositories/activationInviteRepository.js"
import type { AuditWriteRepository } from "../../repositories/auditRepository.js"
import type { EmailDeliveryWriteRepository } from "../../repositories/emailDeliveryRepository.js"
import type { OutboxWriteRepository } from "../../repositories/outboxRepository.js"
import type { UserWriteRepository } from "../../repositories/userRepository.js"

export interface ResendInviteConfig {
  readonly activationInviteTtlMs: number
  readonly sesConfigurationSet: string
}

export interface ResendInviteDeps {
  readonly userRepository: UserWriteRepository
  readonly activationInviteRepository: ActivationInviteWriteRepository
  readonly outboxRepository: OutboxWriteRepository
  readonly emailDeliveryRepository: EmailDeliveryWriteRepository
  readonly auditRepository: AuditWriteRepository
  readonly crypto: CryptoContext
  readonly clock: () => Date
  readonly config: ResendInviteConfig
}

export interface ResendInviteInput {
  readonly userId: string
  readonly actorUserId: string
  readonly expectedInviteId: string
  readonly reasonCode: string
  readonly requestId: string
}

export interface ResendInviteResult {
  readonly revokedInviteId: string
  readonly activationInvite: ActivationInvite
  readonly emailDelivery: EmailDelivery
}

export const resendActivationInvite = async (
  tx: Transaction,
  deps: ResendInviteDeps,
  input: ResendInviteInput,
): Promise<ResendInviteResult> => {
  const user = await deps.userRepository.lockById(tx, input.userId as UserId)
  if (user === null) throw new AppError("RESOURCE_NOT_FOUND")
  if (user.application_id === null) throw new AppError("STATE_CONFLICT")

  const current = await deps.activationInviteRepository.lockPendingByUserId(tx, input.userId)
  if (current === null || current.id !== input.expectedInviteId) throw new AppError("STATE_CONFLICT")

  const now = deps.clock()
  const revoked = await deps.activationInviteRepository.revoke(tx, {
    inviteId: current.id,
    reason: "resend",
    now,
  })
  if (revoked === null) throw new AppError("STATE_CONFLICT")

  const token = deps.crypto.generateVerificationToken()
  const invite = await deps.activationInviteRepository.create(tx, {
    userId: user.id,
    applicationId: user.application_id,
    tokenHash: token.hash,
    tokenKeyVersion: token.keyVersion,
    expiresAt: new Date(now.getTime() + deps.config.activationInviteTtlMs),
    createdByUserId: input.actorUserId,
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
  const recipient = user.email_normalized
  const envelope = deps.crypto.encryptRecipient(recipient)
  const emailDelivery = await deps.emailDeliveryRepository.createActivationInviteDelivery(tx, {
    outboxEventId: outbox.id,
    userId: user.id,
    applicationId: user.application_id,
    activationInviteId: invite.id,
    recipientCiphertext: envelope.ciphertext,
    recipientNonce: envelope.nonce,
    recipientHmac: deps.crypto.hmacRecipient(recipient).hash,
    recipientMasked: deps.crypto.maskEmail(recipient),
    recipientEncryptionKeyVersion: envelope.keyVersion,
    suppressionHmacKeyVersion: deps.crypto.suppressionHmacKeyVersion,
    sesConfigurationSet: deps.config.sesConfigurationSet,
    templateVersion: "v1",
  })
  await deps.auditRepository.append(tx, {
    actorType: "admin",
    actorUserId: input.actorUserId,
    command: "user.activation_invite_resend",
    entityType: "user",
    entityId: user.id,
    requestId: input.requestId,
    entityVersion: Number(user.version),
    metadata: { reasonCode: input.reasonCode },
  })
  return { revokedInviteId: current.id, activationInvite: invite, emailDelivery }
}
