/**
 * Public application submission command (spec 04 §3.1). Runs inside a
 * caller-owned transaction: a new identifier pair atomically creates the
 * application (directly in `submitted`, visible to the admin approvals queue),
 * authoritative consent evidence, and an audit event.
 *
 * There is deliberately no pre-approval email verification and no verification
 * mail: the admin decision is the gate, and email confirmation happens later
 * inside the app as the Email OTP Verification step. What used to be queued here (a
 * verification token + `verify_email` delivery + outbox trigger) is gone, and
 * so is the resend-cooldown machinery that bounded it.
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
 * Every path now reports which of three things happened, and every path writes
 * an audit event.
 */
import type { CryptoContext } from "../../crypto/context.js"
import type { Transaction } from "../../db/repositories.js"
import { AppError } from "../../http/errorCatalog.js"
import type { ApplicationWriteRepository } from "../../repositories/applicationRepository.js"
import type { AuditWriteRepository } from "../../repositories/auditRepository.js"
import type { ConsentRepositoryImpl } from "../../repositories/consentRepository.js"

export interface SubmitApplicationDeps {
  readonly applicationRepository: ApplicationWriteRepository
  readonly consentRepository: ConsentRepositoryImpl
  readonly auditRepository: AuditWriteRepository
  readonly crypto: CryptoContext
  readonly clock: () => Date
}

export interface SubmitApplicationInput {
  readonly fullName: string
  readonly emailNormalized: string
  readonly phoneE164: string
  /**
   * Argon2id hash of the password the applicant chose. Already hashed by the
   * route: this command runs inside a transaction and Argon2id is intentionally
   * slow, so the cost belongs outside.
   */
  readonly passwordHash: string
  readonly consents: readonly { readonly kind: "terms" | "privacy"; readonly version: string }[]
  readonly requestId: string
  readonly clientIp: string
  readonly userAgent: string | null
}

/**
 * What the submission actually did.
 *
 * `created` means the application is now sitting in the admin approvals queue.
 * The two `duplicate_` cases mean nothing was written.
 */
export type SubmitApplicationOutcome =
  /** A new application exists and is awaiting the admin decision. */
  | { readonly kind: "created"; readonly applicationId: string }
  /**
   * An application for this identity is already in flight — sitting in the
   * approvals queue — so there is nothing more to submit.
   */
  | { readonly kind: "duplicate_pending"; readonly applicationId: string }
  /** The email or phone already belongs to a user account. */
  | { readonly kind: "duplicate_account" }

const MAX_USER_AGENT_LENGTH = 512

const truncateUserAgent = (userAgent: string | null): string | null => {
  if (userAgent === null) return null
  const stripped = userAgent.replace(/[\u0000-\u001f\u007f-\u009f]/gu, "")
  const trimmed = stripped.trim()
  if (trimmed === "") return null
  return trimmed.slice(0, MAX_USER_AGENT_LENGTH)
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
    /*
     * Nothing is re-sent or re-created: the existing row is already in the
     * approvals queue, and the discard is recorded so a thrown-away submission
     * is never invisible. `matchedOn` says which identifier collided without
     * storing the address itself.
     */
    await deps.auditRepository.append(tx, {
      actorType: "public",
      command: "application.submit_discarded",
      entityType: "application",
      entityId: existing.id,
      fromState: existing.state,
      toState: existing.state,
      requestId: input.requestId,
      entityVersion: Number(existing.version),
      metadata: { reason: "application_in_flight", matchedOn: conflict.matchedOn },
    })
    return { kind: "duplicate_pending", applicationId: existing.id }
  }

  const application = await deps.applicationRepository.createSubmission(tx, {
    emailNormalized: input.emailNormalized,
    phoneE164: input.phoneE164,
    fullName: input.fullName,
    passwordHash: input.passwordHash,
    submittedAt: now,
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

  await deps.auditRepository.append(tx, {
    actorType: "public",
    command: "application.submit",
    entityType: "application",
    entityId: application.id,
    toState: "submitted",
    requestId: input.requestId,
    entityVersion: 1,
    metadata: {},
  })

  return { kind: "created", applicationId: application.id }
}
