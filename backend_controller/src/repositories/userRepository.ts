/**
 * User repository (spec 03 §7). Owns identity lookups and the account-state
 * transitions consumed by activation and native login.
 */
import { sql } from "kysely"

import type { Transaction, User, UserCredential, UserId } from "../db/repositories.js"

export interface UserWithCredential {
  readonly user: User
  readonly credential: UserCredential | null
}

export interface RolesAndPermissions {
  readonly roles: readonly string[]
  readonly permissions: readonly string[]
}

export interface UserWriteRepository {
  lockById: (tx: Transaction, userId: UserId) => Promise<User | null>
  activate: (tx: Transaction, userId: UserId, now: Date) => Promise<User>
  lockByEmailWithCredential: (tx: Transaction, emailNormalized: string) => Promise<UserWithCredential | null>
  findActiveRolesAndPermissions: (tx: Transaction, userId: UserId) => Promise<RolesAndPermissions>
}

export const createUserRepository = (): UserWriteRepository => ({
  lockById: async (tx, userId) => {
    const row = await tx.selectFrom("users").selectAll().where("id", "=", userId).forUpdate().executeTakeFirst()
    return row ?? null
  },

  activate: async (tx, userId, now) =>
    tx
      .updateTable("users")
      .set({
        account_state: "active",
        activated_at: now,
        version: sql<string>`version + 1`,
        updated_at: sql<Date>`now()`,
      })
      .where("id", "=", userId)
      .where("account_state", "=", "invited")
      .returningAll()
      .executeTakeFirstOrThrow(),

  lockByEmailWithCredential: async (tx, emailNormalized) => {
    const user = await tx
      .selectFrom("users")
      .selectAll()
      .where("email_normalized", "=", emailNormalized)
      .forUpdate()
      .executeTakeFirst()
    if (user === undefined) return null
    const credential = await tx
      .selectFrom("user_credentials")
      .selectAll()
      .where("user_id", "=", user.id)
      .forUpdate()
      .executeTakeFirst()
    return { user, credential: credential ?? null }
  },

  findActiveRolesAndPermissions: async (tx, userId) => {
    const result = await sql<{ roles: string[]; permissions: string[] }>`
      select
        coalesce(array_agg(distinct r.code) filter (where r.code is not null), '{}') as roles,
        coalesce(array_agg(distinct p.code) filter (where p.code is not null), '{}') as permissions
      from user_roles ur
      join roles r on r.id = ur.role_id
      left join role_permissions rp on rp.role_id = r.id and rp.revoked_at is null
      left join permissions p on p.id = rp.permission_id
      where ur.user_id = ${userId} and ur.revoked_at is null
    `.execute(tx)
    const row = result.rows[0]
    return { roles: row?.roles ?? [], permissions: row?.permissions ?? [] }
  },
})
