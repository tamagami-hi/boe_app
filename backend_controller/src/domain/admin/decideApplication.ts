/**
 * Decide an application (spec 04 §3.2). Single step: an admin approves or
 * rejects directly from `submitted`. There is no review handshake, no reason
 * the admin has to type, and no unverified-email gate — the decision itself is
 * the only gate, and the review row records a fixed internal audit code so the
 * trail stays complete without demanding ceremony from the reviewer.
 *
 * Approval always takes one shape: the applicant chose their password at
 * signup, so the decision creates the user already `active`, copies the Argon2id
 * hash into `user_credentials`, and queues the `account_approved` mail. That
 * mail carries the official client APK download link (resolved by the route
 * from the published release feed) and tells the recipient to sign in with the
 * credentials they already chose — there is nothing left to redeem, and the
 * legacy activation-invite branch is gone.
 *
 * Rejection atomically creates the review, audit event, rejection outbox event,
 * and a token-free rejection delivery, and creates no user or credential.
 * Onboarding decisions use no maker-checker.
 */
import type {
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

export interface DecideApplicationConfig {
  readonly sesConfigurationSet: string
}

export interface DecideApplicationDeps {
  readonly applicationRepository: ApplicationWriteRepository
  readonly applicationReviewRepository: ApplicationReviewWriteRepository
  readonly userRepository: UserWriteRepository
  readonly credentialRepository: CredentialWriteRepository
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
  /**
   * Public download URL of the newest published client APK, resolved by the
   * route from the release feed, or null when no APK is published. Carried into
   * the approval mail's template data; null means the mail goes out without a
   * link (the route logs the warning).
   */
  readonly apkDownloadUrl: string | null
  readonly requestId: string
  readonly idempotencyKey: string
}

export interface DecideApplicationResult {
  readonly application: Application
  readonly review: ApplicationReview
  readonly user: User | null
  readonly emailDelivery: EmailDelivery
  /** True when the account can be signed into right away with the signup password. */
  readonly accountActivated: boolean
}

/**
 * The fixed internal audit code recorded on the review row. The admin no longer
 * supplies a reason — the console offers exactly Approve/Reject — but the
 * schema keeps `reason_code` NOT NULL, so the decision itself is the code.
 */
const auditReasonCode = (decision: "approved" | "rejected"): string =>
  decision === "approved" ? "admin_approved" : "admin_rejected"

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

  // Read before applyDecision clears it: the decision update wipes the signup
  // hash, so the value has to be taken from the locked row.
  const signupPasswordHash = application.password_hash
  if (input.decision === "approved" && signupPasswordHash === null) {
    // Unreachable for signups that came through /newuser (password is required
    // there); a row without one cannot produce a sign-in-ready account.
    throw new AppError("STATE_CONFLICT", {
      message: "This application has no signup password on file, so it cannot be approved into an account.",
    })
  }

  const now = deps.clock()
  const decided = await deps.applicationRepository.applyDecision(tx, {
    applicationId: input.applicationId,
    decision: input.decision,
    now,
  })
  if (decided === null) {
    // The guarded UPDATE matched no row, so another transaction moved this
    // application out of `submitted` between the lock and the write.
    throw new AppError("STATE_CONFLICT", {
      message: "This application changed while you were deciding it. Reload the queue and decide again.",
    })
  }

  const review = await deps.applicationReviewRepository.insert(tx, {
    applicationId: input.applicationId,
    reviewerUserId: input.reviewerUserId,
    decision: input.decision,
    reasonCode: auditReasonCode(input.decision),
    reasonDetail: null,
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
  const auditMetadata = { decision: input.decision }

  if (input.decision === "approved") {
    // The credential the applicant chose at signup, moved to the table that
    // owns it. No token is issued: there is nothing left for them to set.
    const user = await deps.userRepository.createActive(tx, {
      applicationId: input.applicationId,
      emailNormalized: application.email_normalized,
      phoneE164: application.phone_e164,
      fullName: application.full_name,
      activatedAt: now,
    })
    await deps.credentialRepository.create(tx, user.id as UserId, signupPasswordHash as string)
    const outbox = await deps.outboxRepository.enqueue(tx, {
      topic: "email",
      eventType: "user.account_approved",
      eventVersion: 1,
      aggregateType: "user",
      aggregateId: user.id,
      requestId: input.requestId,
      deduplicationKey: `account_approved:${user.id}`,
      payload: { template: "account_approved", downloadUrl: input.apkDownloadUrl },
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
      fromState: "submitted",
      toState: "approved",
      requestId: input.requestId,
      entityVersion: Number(decided.version),
      metadata: {
        ...auditMetadata,
        credentialSource: "signup",
        accountState: "active",
        apkLinkIncluded: input.apkDownloadUrl !== null,
      },
    })
    return {
      application: decided,
      review,
      user,
      emailDelivery,
      accountActivated: true,
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
    fromState: "submitted",
    toState: "rejected",
    requestId: input.requestId,
    entityVersion: Number(decided.version),
    metadata: auditMetadata,
  })
  return {
    application: decided,
    review,
    user: null,
    emailDelivery,
    accountActivated: false,
  }
}
