/**
 * Application repository (spec 03 §7, 04 §3.1). Owns application-row creation and
 * the active-identity conflict probe used by the uniform-response submission.
 */
import { sql } from "kysely"

import type { Application, Transaction } from "../db/repositories.js"

export interface CreateSubmissionInput {
  readonly emailNormalized: string
  readonly phoneE164: string
  readonly fullName: string
}

export interface ApplicationWriteRepository {
  hasActiveConflict: (
    tx: Transaction,
    input: Readonly<{ emailNormalized: string; phoneE164: string }>,
  ) => Promise<boolean>
  createSubmission: (tx: Transaction, input: CreateSubmissionInput) => Promise<Application>
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
      })
      .returningAll()
      .executeTakeFirstOrThrow(),
})
