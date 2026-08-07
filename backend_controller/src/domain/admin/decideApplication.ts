/**
 * Decide an application (spec 04 §3.2). Both outcomes require `in_review`, the
 * If-Match version, and no prior decision.
 *
 * Approval takes one of two shapes depending on whether the applicant chose a
 * password when they signed up:
 *
 *   - password on file (the current signup form) — creates the user, copies the
 *     Argon2id hash into `user_credentials`, and activates the account. The
 *     person can sign in immediately with the password they already chose, and
 *     the mail is a notification rather than something to redeem.
 *   - no password (an application submitted before password-at-signup) — creates
 *     an invited user and a single-use activation invite, and the password is
 *     chosen when that invite is redeemed.
 *
 * The second shape is the reason nothing here is deleted: rows already in the
 * queue must still be approvable, and their only route to a credential is the
 * invite.
 *
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
  UserId,
} from "../../db/repositories.js"
import type { CryptoContext } from "../../crypto/context.js"
import { AppError } from "../../http/errorCatalog.js"
import type { ApplicationWriteRepository } from "../../repositories/applicationRepository.js"
import type { ApplicationReviewWriteRepository } from "../../repositories/applicationReviewRepository.js"
import type { AuditWriteRepository } from "../../repositories/auditRepository.js"
import type { CredentialWriteRepository } from "../../repositories/credentialRepository.js"
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
  readonly credentialRepository: CredentialWriteRepository
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
  /**
   * Explicit acknowledgement that the applicant never confirmed their email
   * address. Approving without a confirmed address is a judgement the reviewer
   * has to make deliberately, so the caller has to say so rather than the server
   * quietly allowing it: the admin console asks for a second confirmation and
   * the choice is recorded in the audit event.
   */
  readonly allowUnverifiedEmail: boolean
  readonly requestId: string
  readonly idempotencyKey: string
}

export interface DecideApplicationResult {
  readonly application: Application
  readonly review: ApplicationReview
  readonly user: User | null
  readonly activationInvite: ActivationInvite | null
  readonly emailDelivery: EmailDelivery
  /** True when the account can be signed into right away with the signup password. */
  readonly accountActivated: boolean
}

export const decideApplication = async (
  tx: Transaction,
  deps: DecideApplicationDeps,
  input: DecideApplicationInput,
): Promise<DecideApplicationResult> => {
  const application = await deps.applicationRepository.lockById(tx, input.applicationId)
  if (application === null) throw new AppError("RESOURCE_NOT_FOUND")

  /*
   * Each refusal below carries its own message. They are all genuinely 409, but
   * the catalog default ("the resource changed; retry with the current version")
   * only describes the first of them, and telling a reviewer to retry an
   * already-decided application sends them round a loop that cannot succeed.
   */
  if (application.state === "approved" || application.state === "rejected") {
    throw new AppError("STATE_CONFLICT", {
      message: `This application was already ${application.state}. Reload the queue to see its current state.`,
    })
  }
  if (application.state === "withdrawn") {
    throw new AppError("STATE_CONFLICT", { message: "This application was withdrawn and can no longer be decided." })
  }
  if (application.state !== "in_review") {
    throw new AppError("STATE_CONFLICT", {
      message: "This application must be moved into review before it can be decided.",
    })
  }
  if (Number(application.version) !== input.expectedVersion) {
    throw new AppError("STATE_CONFLICT", {
      message: "This application changed while you were reviewing it. Reload the queue and decide again.",
    })
  }
  /*
   * An unconfirmed email blocks approval unless the reviewer says otherwise, and
   * never blocks rejection — refusing to reject an application because its
   * address is unconfirmed would leave it stuck in the queue forever.
   */
  if (input.decision === "approved" && application.email_verified_at === null && !input.allowUnverifiedEmail) {
    throw new AppError("STATE_CONFLICT", {
      message:
        "This applicant has not confirmed their email address. Confirm that you want to approve them anyway before continuing.",
    })
  }

  // Read before applyDecision clears it: the decision update wipes the signup
  // hash, so the value has to be taken from the locked row.
  const signupPasswordHash = application.password_hash

  const now = deps.clock()
  const decided = await deps.applicationRepository.applyDecision(tx, {
    applicationId: input.applicationId,
    decision: input.decision,
    now,
  })
  if (decided === null) {
    // The guarded UPDATE matched no row, so another transaction moved this
    // application between the lock and the write.
    throw new AppError("STATE_CONFLICT", {
      message: "This application changed while you were reviewing it. Reload the queue and decide again.",
    })
  }

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
  const auditMetadata = {
    decision: input.decision,
    reasonCode: input.reasonCode,
    // Recorded on every decision so the trail answers "was the address
    // confirmed when this was decided?" without re-deriving it from timestamps.
    emailVerifiedAtDecision: application.email_verified_at !== null,
  }

  if (input.decision === "approved") {
    const user = await deps.userRepository.createInvited(tx, {
      applicationId: input.applicationId,
      emailNormalized: application.email_normalized,
      phoneE164: application.phone_e164,
      fullName: application.full_name,
    })

    if (signupPasswordHash !== null) {
      // The credential the applicant chose at signup, moved to the table that
      // owns it. No token is issued: there is nothing left for them to set.
      await deps.credentialRepository.create(tx, user.id as UserId, signupPasswordHash)
      const activated = await deps.userRepository.activate(tx, user.id as UserId, now)
      const outbox = await deps.outboxRepository.enqueue(tx, {
        topic: "email",
        eventType: "user.account_approved",
        eventVersion: 1,
        aggregateType: "user",
        aggregateId: user.id,
        requestId: input.requestId,
        deduplicationKey: `account_approved:${user.id}`,
        payload: { template: "account_approved" },
      })
      const emailDelivery = await deps.emailDeliveryRepository.createAccountApprovedDelivery(tx, {
        outboxEventId: outbox.id,
        userId: user.id,
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
        toState: "approved",
        requestId: input.requestId,
        entityVersion: Number(decided.version),
        metadata: { ...auditMetadata, credentialSource: "signup", accountState: "active" },
      })
      return {
        application: decided,
        review,
        user: activated,
        activationInvite: null,
        emailDelivery,
        accountActivated: true,
      }
    }

    // Legacy path: no password on file, so the account stays invited until the
    // emailed invite is redeemed and a password is chosen.
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
      metadata: { ...auditMetadata, credentialSource: "activation_invite", accountState: "invited" },
    })
    return {
      application: decided,
      review,
      user,
      activationInvite: invite,
      emailDelivery,
      accountActivated: false,
    }
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
    metadata: auditMetadata,
  })
  return {
    application: decided,
    review,
    user: null,
    activationInvite: null,
    emailDelivery,
    accountActivated: false,
  }
}
