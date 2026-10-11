import { sql } from "kysely"

import type { Transaction } from "../db/repositories.js"

export interface IdentityClaim {
  readonly emailNormalized?: string
  readonly phoneE164?: string
}

export interface IdentityLockRepository {
  lockIdentities: (tx: Transaction, claim: IdentityClaim) => Promise<void>
}

export const identityLockKeys = (claim: IdentityClaim): readonly string[] => {
  const keys = [
    ...(claim.emailNormalized === undefined ? [] : [`identity:email:${claim.emailNormalized}`]),
    ...(claim.phoneE164 === undefined ? [] : [`identity:phone:${claim.phoneE164}`]),
  ]
  return [...new Set(keys)].sort()
}

export const createIdentityLockRepository = (): IdentityLockRepository => ({
  lockIdentities: async (tx, claim) => {
    for (const key of identityLockKeys(claim)) {
      await sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`.execute(tx)
    }
  },
})
