/**
 * Credential repository (spec 03 §7). Stores only the encoded Argon2id hash
 * (the `user_credentials` CHECK enforces the `$argon2id$` prefix). Password
 * hashing happens in the command layer via `src/auth/passwordHasher.ts`.
 */
import { sql } from "kysely"

import type { Transaction, UserCredential, UserId } from "../db/repositories.js"

export interface CredentialWriteRepository {
  exists: (tx: Transaction, userId: UserId) => Promise<boolean>
  create: (tx: Transaction, userId: UserId, argon2idHash: string) => Promise<UserCredential>
}

export const createCredentialRepository = (): CredentialWriteRepository => ({
  exists: async (tx, userId) => {
    const result = await sql<{ present: boolean }>`
      select exists (select 1 from user_credentials where user_id = ${userId}) as present
    `.execute(tx)
    return result.rows[0]?.present ?? false
  },
  create: async (tx, userId, argon2idHash) =>
    tx
      .insertInto("user_credentials")
      .values({ user_id: userId, password_hash: argon2idHash })
      .returningAll()
      .executeTakeFirstOrThrow(),
})
