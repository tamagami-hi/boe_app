/**
 * User repository (spec 03 §7). Owns identity lookups and the account creation
 * consumed by the admin approval decision and native login.
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

export interface CreateActiveUserInput {
  readonly applicationId: string
  readonly emailNormalized: string
  readonly phoneE164: string
  readonly fullName: string
  readonly activatedAt: Date
}

export interface UserWriteRepository {
  lockById: (tx: Transaction, userId: UserId) => Promise<User | null>
  /**
   * Create the active user for an approved application. Approval is the only
   * door to an account now — the signup password is copied into
   * `user_credentials` in the same transaction, so the account is sign-in ready
   * the moment the decision commits. There is no invited state to pass through.
   */
  createActive: (tx: Transaction, input: CreateActiveUserInput) => Promise<User>
  lockByEmailWithCredential: (tx: Transaction, emailNormalized: string) => Promise<UserWithCredential | null>
  findActiveRolesAndPermissions: (tx: Transaction, userId: UserId) => Promise<RolesAndPermissions>
}

export const createUserRepository = (): UserWriteRepository => ({
  lockById: async (tx, userId) => {
    const row = await tx.selectFrom("users").selectAll().where("id", "=", userId).forUpdate().executeTakeFirst()
    return row ?? null
  },

  createActive: async (tx, input) =>
    tx
      .insertInto("users")
      .values({
        application_id: input.applicationId,
        email_normalized: input.emailNormalized,
        phone_e164: input.phoneE164,
        full_name: input.fullName,
        account_state: "active",
        activated_at: input.activatedAt,
      })
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
