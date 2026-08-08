/**
 * Application repository (spec 03 §7, 04 §3.1/§3.2). Owns application-row
 * creation, the active-identity conflict probe used by the uniform-response
 * submission, and the admin queue/detail reads plus review/decision state
 * transitions.
 */
import { sql } from "kysely"

import type { Application, ApplicationReview, Transaction } from "../db/repositories.js"
import type { ApplicationState } from "../db/types.js"

export interface CreateSubmissionInput {
  readonly emailNormalized: string
  readonly phoneE164: string
  readonly fullName: string
  /**
   * Argon2id hash of the password chosen at signup, or null for a caller that
   * does not collect one. Hashing happens before the transaction opens — Argon2id
   * is deliberately slow, and holding a write transaction open across it would
   * put that cost inside the lock.
   */
  readonly passwordHash: string | null
}

export interface ApplicationQueueQuery {
  readonly states?: readonly ApplicationState[]
  readonly createdFrom?: Date
  readonly createdTo?: Date
  readonly afterCreatedAt?: Date
  readonly afterId?: string
  readonly limit: number
}

export interface ApplicationConsentDetailRow {
  readonly kind: "terms" | "privacy"
  readonly version: string
  readonly acceptedAt: Date
}

/** Which of the submitted identifiers the existing row was found by. */
export type ConflictMatch = "email" | "phone" | "both"

/**
 * Why a submission cannot create a new application.
 *
 * This replaced a bare `hasActiveConflict: () => boolean`. A boolean could only
 * ever produce a silent no-op: the route had no way to tell an applicant still
 * waiting on their confirmation email (whose mail should be resent) from an
 * identity that already owns an account (where there is nothing to resend), so
 * both were discarded and both were answered `202 accepted: true`.
 */
export type ActiveConflict =
  | {
      readonly kind: "user"
      readonly userId: string
      readonly userVersion: number
      readonly matchedOn: ConflictMatch
    }
  | {
      readonly kind: "application"
      readonly application: Application
      readonly matchedOn: ConflictMatch
    }

export interface IdentityInput {
  readonly emailNormalized: string
  readonly phoneE164: string
}

/**
 * Which submitted identifier(s) the found row shares. Pure; used only to describe
 * a discarded submission in the audit trail, never to decide anything.
 */
const matchOf = (input: IdentityInput, email: string, phone: string): ConflictMatch => {
  const byEmail = email === input.emailNormalized
  const byPhone = phone === input.phoneE164
  if (byEmail && byPhone) return "both"
  return byEmail ? "email" : "phone"
}

export interface ApplicationWriteRepository {
  findActiveConflict: (tx: Transaction, input: IdentityInput) => Promise<ActiveConflict | null>
  /**
   * How many times this identity has already been through a terminal decision.
   *
   * Feeds the public route's derived idempotency key so a resubmission after a
   * rejection hashes differently from the submission that was rejected. Without
   * it, the 24-hour idempotency record outlived the decision and replayed
   * yesterday's `202` — creating nothing, emailing nothing, and leaving the
   * applicant with no way to reapply until the record expired.
   */
  countTerminalSubmissions: (tx: Transaction, input: IdentityInput) => Promise<number>
  createSubmission: (tx: Transaction, input: CreateSubmissionInput) => Promise<Application>
  markEmailVerified: (
    tx: Transaction,
    input: Readonly<{ applicationId: string; verifiedAt: Date }>,
  ) => Promise<Application>
  findById: (tx: Transaction, applicationId: string) => Promise<Application | null>
  lockById: (tx: Transaction, applicationId: string) => Promise<Application | null>
  queue: (tx: Transaction, query: ApplicationQueueQuery) => Promise<readonly Application[]>
  startReview: (tx: Transaction, input: Readonly<{ applicationId: string; now: Date }>) => Promise<Application | null>
  applyDecision: (
    tx: Transaction,
    input: Readonly<{ applicationId: string; decision: "approved" | "rejected"; now: Date }>,
  ) => Promise<Application | null>
  listConsentDetails: (tx: Transaction, applicationId: string) => Promise<readonly ApplicationConsentDetailRow[]>
  listReviews: (tx: Transaction, applicationId: string) => Promise<readonly ApplicationReview[]>
}

export const createApplicationRepository = (): ApplicationWriteRepository => ({
  /*
   * Users are checked before applications: an identity that already owns an
   * account is a harder stop than one with a submission in flight, and the
   * account case has nothing to resend.
   *
   * `matchedOn` exists so the audit trail records *why* a submission was
   * discarded without storing the address itself. Note a submission can collide
   * with one row by email and a different row by phone; the email match wins,
   * because the email is the only channel a resend could legitimately use.
   */
  findActiveConflict: async (tx, input) => {
    const user = await tx
      .selectFrom("users")
      .select(["id", "version", "email_normalized", "phone_e164"])
      .where((eb) =>
        eb.or([
          eb("email_normalized", "=", input.emailNormalized),
          eb("phone_e164", "=", input.phoneE164),
        ]),
      )
      // Deterministic when the email and the phone belong to two different
      // accounts: the email-matching one is reported.
      .orderBy(sql`case when email_normalized = ${input.emailNormalized} then 0 else 1 end`, "asc")
      .limit(1)
      .executeTakeFirst()

    if (user !== undefined) {
      return {
        kind: "user",
        userId: user.id,
        userVersion: Number(user.version),
        matchedOn: matchOf(input, user.email_normalized, user.phone_e164),
      }
    }

    const application = await tx
      .selectFrom("applications")
      .selectAll()
      .where((eb) =>
        eb.or([
          eb("email_normalized", "=", input.emailNormalized),
          eb("phone_e164", "=", input.phoneE164),
        ]),
      )
      .where("state", "not in", ["rejected", "withdrawn"])
      .orderBy(sql`case when email_normalized = ${input.emailNormalized} then 0 else 1 end`, "asc")
      .limit(1)
      .executeTakeFirst()

    if (application === undefined) return null
    return {
      kind: "application",
      application,
      matchedOn: matchOf(input, application.email_normalized, application.phone_e164),
    }
  },

  /*
   * Counts terminal rows only. Live rows are excluded deliberately: while one is
   * active the count must not move, or two rapid submissions of the same details
   * would derive different keys and defeat the duplicate collapsing the key exists
   * for. A decision is the only thing that advances it.
   */
  countTerminalSubmissions: async (tx, input) => {
    const row = await tx
      .selectFrom("applications")
      .select((eb) => eb.fn.countAll<string>().as("count"))
      .where((eb) =>
        eb.or([
          eb("email_normalized", "=", input.emailNormalized),
          eb("phone_e164", "=", input.phoneE164),
        ]),
      )
      .where("state", "in", ["rejected", "withdrawn"])
      .executeTakeFirst()
    return Number(row?.count ?? 0)
  },

  createSubmission: async (tx, input) =>
    tx
      .insertInto("applications")
      .values({
        email_normalized: input.emailNormalized,
        phone_e164: input.phoneE164,
        full_name: input.fullName,
        password_hash: input.passwordHash,
      })
      .returningAll()
      .executeTakeFirstOrThrow(),

  markEmailVerified: async (tx, input) =>
    tx
      .updateTable("applications")
      .set({
        state: "submitted",
        email_verified_at: input.verifiedAt,
        submitted_at: input.verifiedAt,
        version: sql<string>`version + 1`,
        updated_at: sql<Date>`now()`,
      })
      .where("id", "=", input.applicationId)
      .where("state", "=", "pending_email_verification")
      .returningAll()
      .executeTakeFirstOrThrow(),

  findById: async (tx, applicationId) => {
    const row = await tx.selectFrom("applications").selectAll().where("id", "=", applicationId).executeTakeFirst()
    return row ?? null
  },

  lockById: async (tx, applicationId) => {
    const row = await tx
      .selectFrom("applications")
      .selectAll()
      .where("id", "=", applicationId)
      .forUpdate()
      .executeTakeFirst()
    return row ?? null
  },

  queue: async (tx, query) => {
    let builder = tx.selectFrom("applications").selectAll()
    if (query.states !== undefined && query.states.length > 0) {
      builder = builder.where("state", "in", [...query.states])
    }
    if (query.createdFrom !== undefined) builder = builder.where("created_at", ">=", query.createdFrom)
    if (query.createdTo !== undefined) builder = builder.where("created_at", "<=", query.createdTo)
    if (query.afterCreatedAt !== undefined && query.afterId !== undefined) {
      const afterCreatedAt = query.afterCreatedAt
      const afterId = query.afterId
      // Keyset for (created_at DESC, id DESC): strictly "before" the cursor row.
      builder = builder.where((eb) =>
        eb.or([
          eb("created_at", "<", afterCreatedAt),
          eb.and([eb("created_at", "=", afterCreatedAt), eb("id", "<", afterId)]),
        ]),
      )
    }
    return builder.orderBy("created_at", "desc").orderBy("id", "desc").limit(query.limit).execute()
  },

  startReview: async (tx, input) => {
    const row = await tx
      .updateTable("applications")
      .set({
        state: "in_review",
        review_started_at: input.now,
        version: sql<string>`version + 1`,
        updated_at: sql<Date>`now()`,
      })
      .where("id", "=", input.applicationId)
      // Both pre-review states are accepted. See startApplicationReview for why
      // `pending_email_verification` is reviewable: the confirmation mail is not
      // guaranteed to arrive, and gating review on it left applications stuck.
      .where("state", "in", ["submitted", "pending_email_verification"])
      .returningAll()
      .executeTakeFirst()
    return row ?? null
  },

  applyDecision: async (tx, input) => {
    const row = await tx
      .updateTable("applications")
      .set({
        state: input.decision,
        decided_at: input.now,
        // Both outcomes are terminal, so the signup hash has done its job: an
        // approval has already copied it into `user_credentials` (read from the
        // locked row before this update) and a rejection will never produce an
        // account. Clearing it here keeps exactly one copy of any live credential
        // material, in the table whose rotation and lockout columns govern it.
        password_hash: null,
        version: sql<string>`version + 1`,
        updated_at: sql<Date>`now()`,
      })
      .where("id", "=", input.applicationId)
      .where("state", "=", "in_review")
      .returningAll()
      .executeTakeFirst()
    return row ?? null
  },

  listConsentDetails: async (tx, applicationId) =>
    tx
      .selectFrom("application_consents as ac")
      .innerJoin("consent_documents as cd", "cd.id", "ac.consent_document_id")
      .select(["cd.kind as kind", "cd.version as version", "ac.accepted_at as acceptedAt"])
      .where("ac.application_id", "=", applicationId)
      .orderBy("cd.kind", "asc")
      .execute(),

  listReviews: async (tx, applicationId) =>
    tx
      .selectFrom("application_reviews")
      .selectAll()
      .where("application_id", "=", applicationId)
      .orderBy("created_at", "desc")
      .execute(),
})
