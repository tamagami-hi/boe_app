/**
 * Public application submission command (spec 04 §3.1). Runs inside a
 * caller-owned transaction: a new identifier pair atomically creates the
 * application, authoritative consent evidence, a verification token (hash only),
 * an email delivery, an outbox trigger, and an audit event.
 *
 * ── WHY THIS NO LONGER RETURNS `void` ───────────────────────────────────────
 * It used to return nothing and treat every identity conflict as a silent no-op,
 * so the route answered `202 { accepted: true }` for three different things: a
 * new application, an applicant who already had one in flight, and an identity
 * that already owned an account. The caller could not tell them apart, could not
 * tell the visitor anything true, and — because the conflict branch returned
 * before the audit append — the two discarding cases left no trace anywhere. An
 * operator looking at an empty approvals queue could not distinguish a signup
 * that never arrived from one that was thrown away on purpose.
 *
 * Every path now reports which of four things happened, and every path writes an
 * audit event.
 *
 * Deferred to BE-008b-3: the cross-match security metric, and savepoint handling
 * for the rare concurrent uniqueness race (currently a retryable failure).
 * Deferred to BE-012: hardening the transient raw token carried in the outbox
 * payload.
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
  /**
   * How long after the last verification mail a resubmission is allowed to queue
   * another one. Bounds the mail a caller can cause for one address: without it,
   * a form that is submitted repeatedly (a visitor who never received the first
   * message and keeps trying) would queue one message per attempt.
   */
  readonly verificationResendCooldownMs: number
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
  /**
   * Argon2id hash of the password the applicant chose, or null when the caller
   * collects no password. Already hashed by the route: this command runs inside a
   * transaction and Argon2id is intentionally slow, so the cost belongs outside.
   */
  readonly passwordHash: string | null
  readonly consents: readonly { readonly kind: "terms" | "privacy"; readonly version: string }[]
  readonly requestId: string
  readonly clientIp: string
  readonly userAgent: string | null
}

/**
 * What the submission actually did.
 *
 * `created` and `verification_resent` both mean a verification mail is now queued
 * and the visitor should be told to check their inbox. The two `duplicate_` cases
 * mean nothing was written and nothing was sent.
 */
export type SubmitApplicationOutcome =
  /** A new application exists and its verification mail is queued. */
  | { readonly kind: "created"; readonly applicationId: string }
  /**
   * The identity already had an application awaiting email confirmation, and the
   * cooldown had elapsed, so a fresh token and mail were queued for it. This is
   * what a person who never received the first message actually wants.
   */
  | { readonly kind: "verification_resent"; readonly applicationId: string }
  /**
   * An application for this identity is already in flight and no mail was queued
   * — either it is past email confirmation (so it is sitting in the review queue
   * and there is nothing to confirm), or the resend cooldown has not elapsed, or
   * the collision was on the phone number and the submitted address is not the
   * one on the existing row.
   */
  | { readonly kind: "duplicate_pending"; readonly applicationId: string }
  /** The email or phone already belongs to a user account. Nothing to resend. */
  | { readonly kind: "duplicate_account" }

const MAX_USER_AGENT_LENGTH = 512

const truncateUserAgent = (userAgent: string | null): string | null => {
  if (userAgent === null) return null
  const stripped = userAgent.replace(/[\u0000-\u001f\u007f-\u009f]/gu, "")
  const trimmed = stripped.trim()
  if (trimmed === "") return null
  return trimmed.slice(0, MAX_USER_AGENT_LENGTH)
}

/**
 * Mint a verification token and queue its mail for `applicationId`.
 *
 * Shared by the create and resend paths so there is one definition of what a
 * verification mail consists of. Any previously issued token is deliberately left
 * valid: tokens are single-use and expiring, and if a delayed first message
 * arrives after a resend, the link in it should still work.
 */
const queueVerificationEmail = async (
  tx: Transaction,
  deps: SubmitApplicationDeps,
  input: Readonly<{ applicationId: string; emailNormalized: string; requestId: string; now: Date }>,
): Promise<void> => {
  const token = deps.crypto.generateVerificationToken()
  const verificationToken = await deps.verificationTokenRepository.create(tx, {
    applicationId: input.applicationId,
    tokenHash: token.hash,
    tokenKeyVersion: token.keyVersion,
    expiresAt: new Date(input.now.getTime() + deps.config.verificationTokenTtlMs),
  })

  const outboxEvent = await deps.outboxRepository.enqueue(tx, {
    topic: "email",
    eventType: "application.verification_requested",
    eventVersion: 1,
    aggregateType: "application",
    aggregateId: input.applicationId,
    requestId: input.requestId,
    // Keyed on the token, so a resend is a distinct event rather than a
    // duplicate of the original that the outbox would collapse.
    deduplicationKey: `verify_email:${token.hash.toString("hex")}`,
    // The raw token is transient transport for the worker; BE-012 hardens it.
    payload: { template: "verify_email", verificationToken: token.token },
  })

  const recipientEnvelope = deps.crypto.encryptRecipient(input.emailNormalized)
  const recipientHmac = deps.crypto.hmacRecipient(input.emailNormalized)
  await deps.emailDeliveryRepository.create(tx, {
    outboxEventId: outboxEvent.id,
    applicationId: input.applicationId,
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
}

/** Execute the submission. Reports what happened; see SubmitApplicationOutcome. */
export const submitApplication = async (
  tx: Transaction,
  deps: SubmitApplicationDeps,
  input: SubmitApplicationInput,
): Promise<SubmitApplicationOutcome> => {
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

  const now = deps.clock()
  const conflict = await deps.applicationRepository.findActiveConflict(tx, {
    emailNormalized: input.emailNormalized,
    phoneE164: input.phoneE164,
  })

  if (conflict !== null && conflict.kind === "user") {
    /*
     * Recorded against the account that owns the identity. This is the only
     * durable trace that the attempt happened at all, and it is a security-
     * relevant one: repeated hits here are someone probing which addresses have
     * accounts. Metadata carries no address — `matchedOn` says which identifier
     * collided, which is what an investigation needs.
     */
    await deps.auditRepository.append(tx, {
      actorType: "public",
      command: "application.submit_discarded",
      entityType: "user",
      entityId: conflict.userId,
      requestId: input.requestId,
      entityVersion: conflict.userVersion,
      metadata: { reason: "account_exists", matchedOn: conflict.matchedOn },
    })
    return { kind: "duplicate_account" }
  }

  if (conflict !== null) {
    const existing = conflict.application
    const lastVerifyMail = await deps.emailDeliveryRepository.findLatestByTemplate(tx, {
      applicationId: existing.id,
      templateKey: "verify_email",
    })
    const cooledDown =
      lastVerifyMail === null ||
      now.getTime() - new Date(lastVerifyMail.created_at).getTime() >=
        deps.config.verificationResendCooldownMs

    /*
     * A resend is only correct when all three hold:
     *
     *  - the existing row is still awaiting confirmation. Past that it is in the
     *    review queue and there is nothing left to confirm;
     *  - the existing row's own address is the one just submitted. A phone-only
     *    collision means the submitted address belongs to someone else, and
     *    mailing the row's address would both tell a stranger their details are
     *    on file and send a confirmation nobody asked for;
     *  - the cooldown has elapsed.
     */
    const resendable =
      existing.state === "pending_email_verification" &&
      existing.email_normalized === input.emailNormalized &&
      cooledDown

    if (!resendable) {
      await deps.auditRepository.append(tx, {
        actorType: "public",
        command: "application.submit_discarded",
        entityType: "application",
        entityId: existing.id,
        fromState: existing.state,
        toState: existing.state,
        requestId: input.requestId,
        entityVersion: Number(existing.version),
        metadata: {
          reason: "application_in_flight",
          matchedOn: conflict.matchedOn,
          // Distinguishes "asked again too soon" from "nothing to confirm",
          // which are different operator conversations.
          throttled: existing.state === "pending_email_verification" && !cooledDown,
        },
      })
      return { kind: "duplicate_pending", applicationId: existing.id }
    }

    await queueVerificationEmail(tx, deps, {
      applicationId: existing.id,
      emailNormalized: existing.email_normalized,
      requestId: input.requestId,
      now,
    })
    await deps.auditRepository.append(tx, {
      actorType: "public",
      command: "application.verification_resent",
      entityType: "application",
      entityId: existing.id,
      fromState: existing.state,
      toState: existing.state,
      requestId: input.requestId,
      entityVersion: Number(existing.version),
      metadata: { matchedOn: conflict.matchedOn },
    })
    return { kind: "verification_resent", applicationId: existing.id }
  }

  const application = await deps.applicationRepository.createSubmission(tx, {
    emailNormalized: input.emailNormalized,
    phoneE164: input.phoneE164,
    fullName: input.fullName,
    passwordHash: input.passwordHash,
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

  await queueVerificationEmail(tx, deps, {
    applicationId: application.id,
    emailNormalized: input.emailNormalized,
    requestId: input.requestId,
    now,
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

  return { kind: "created", applicationId: application.id }
}
