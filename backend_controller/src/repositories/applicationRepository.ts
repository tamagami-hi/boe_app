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

export interface ApplicationWriteRepository {
  hasActiveConflict: (
    tx: Transaction,
    input: Readonly<{ emailNormalized: string; phoneE164: string }>,
  ) => Promise<boolean>
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
  hasActiveConflict: async (tx, input) => {
    const result = await sql<{ conflict: boolean }>`
      select (
        exists (
          select 1 from applications
          where (email_normalized = ${input.emailNormalized} or phone_e164 = ${input.phoneE164})
            and state not in ('rejected', 'withdrawn')
        )
        or exists (
          select 1 from users
          where email_normalized = ${input.emailNormalized} or phone_e164 = ${input.phoneE164}
        )
      ) as conflict
    `.execute(tx)
    return result.rows[0]?.conflict ?? false
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
