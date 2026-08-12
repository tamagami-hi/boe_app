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

/**
 * The minimum a sign-in needs about an account: the user row and the stored
 * password hash.
 *
 * Deliberately narrower than `UserWithCredential` — it selects the credential
 * material by name rather than `selectAll()`, and it is read with a single
 * LEFT JOIN instead of two round trips.
 *
 * The hash doubles as the credential's identity. Re-reading it in the
 * session-issuing transaction and comparing detects a password rotated between
 * the verification and the write, which is the invariant the old `FOR UPDATE`
 * held across the whole Argon2 verification to protect. Comparing the hash rather
 * than `password_changed_at` keeps that structural: Argon2 salts each hash
 * randomly, so any rotation necessarily changes this string, and no future
 * password-change command can forget to bump a timestamp and silently disable the
 * check.
 */
export interface UserLoginIdentity {
  readonly user: User
  readonly passwordHash: string | null
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
  /**
   * Non-locking login lookup by email, for use *outside* a transaction.
   *
   * `lockByEmailWithCredential` takes `FOR UPDATE` on the user and credential
   * rows, which the native login used to hold across the Argon2id verification —
   * so two sign-ins for the same account serialized for the full verify, and each
   * one occupied a pooled connection while doing pure CPU work. Login reads these
   * rows and writes neither, so no lock is warranted; `findLoginIdentityById` is
   * used to re-check the facts inside the short transaction that follows.
   */
  findLoginIdentityByEmail: (db: Transaction, emailNormalized: string) => Promise<UserLoginIdentity | null>
  /**
   * The stored password hash for one account, by id.
   *
   * Read inside the session-issuing transaction and compared with the hash that
   * was just verified, so a credential rotated in between cannot yield a session.
   */
  findPasswordHash: (db: Transaction, userId: UserId) => Promise<string | null>
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

  findLoginIdentityByEmail: async (db, emailNormalized) => {
    const row = await db
      .selectFrom("users")
      .leftJoin("user_credentials", "user_credentials.user_id", "users.id")
      .selectAll("users")
      .select(["user_credentials.password_hash"])
      .where("users.email_normalized", "=", emailNormalized)
      .executeTakeFirst()
    if (row === undefined) return null
    const { password_hash: passwordHash, ...user } = row
    return { user, passwordHash }
  },

  findPasswordHash: async (db, userId) => {
    const row = await db
      .selectFrom("user_credentials")
      .select("password_hash")
      .where("user_id", "=", userId)
      .executeTakeFirst()
    return row?.password_hash ?? null
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
