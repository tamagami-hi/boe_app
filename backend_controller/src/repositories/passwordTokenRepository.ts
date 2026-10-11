import { sql } from "kysely"

import type { Transaction, User } from "../db/repositories.js"
import type { PasswordTokenPurpose } from "../db/types.js"
import type { LockedCredential } from "./credentialRepository.js"

export interface PasswordTokenBinding {
  readonly emailRevision: string
  readonly credentialVersion: string
}

export interface PasswordCredentialToken {
  readonly id: string
  readonly userId: string
  readonly purpose: PasswordTokenPurpose
  readonly tokenHash: Buffer
  readonly tokenKeyVersion: string
  readonly attemptCount: number
  readonly expiresAt: Date
  readonly consumedAt: Date | null
  readonly createdAt: Date
  readonly binding: PasswordTokenBinding | null
}

export interface PasswordTokenValidityContext {
  readonly token: Pick<PasswordCredentialToken, "id" | "userId" | "purpose" | "expiresAt" | "consumedAt" | "binding">
  readonly user: Pick<User, "account_state" | "email_revision">
  readonly credential: LockedCredential | null
}

export interface PasswordLinkDeliveryStatus {
  readonly deliveryId: string
  readonly state: string
  readonly lastErrorCode: string | null
  readonly sentAt: Date | null
  readonly updatedAt: Date
}

export interface LatestPasswordLink {
  readonly tokenId: string
  readonly purpose: PasswordTokenPurpose
  readonly createdAt: Date
  readonly expiresAt: Date
  readonly consumedAt: Date | null
  readonly delivery: PasswordLinkDeliveryStatus | null
}

export interface CreatePasswordTokenInput {
  readonly userId: string
  readonly purpose: PasswordTokenPurpose
  readonly tokenHash: Buffer
  readonly tokenKeyVersion: string
  readonly expiresAt: Date
  readonly binding: PasswordTokenBinding
}

export interface PasswordTokenRepository {
  create: (tx: Transaction, input: CreatePasswordTokenInput) => Promise<PasswordCredentialToken>
  lockActive: (tx: Transaction, userId: string) => Promise<PasswordCredentialToken | null>
  findActiveByHash: (tx: Transaction, tokenHash: Buffer) => Promise<PasswordCredentialToken | null>
  lockActiveByHash: (tx: Transaction, tokenHash: Buffer) => Promise<PasswordCredentialToken | null>
  latestCreatedAt: (tx: Transaction, userId: string) => Promise<Date | null>
  findValidityContext: (tx: Transaction, tokenId: string) => Promise<PasswordTokenValidityContext | null>
  findLatestLink: (tx: Transaction, userId: string) => Promise<LatestPasswordLink | null>
  consumeActive: (tx: Transaction, input: Readonly<{ userId: string; now: Date }>) => Promise<void>
  consume: (tx: Transaction, input: Readonly<{ tokenId: string; now: Date }>) => Promise<boolean>
  incrementAttempt: (tx: Transaction, tokenId: string) => Promise<void>
}

const mapToken = (row: {
  readonly id: string
  readonly user_id: string
  readonly purpose: PasswordTokenPurpose
  readonly token_hash: Buffer
  readonly token_key_version: string
  readonly attempt_count: number
  readonly expires_at: Date
  readonly consumed_at: Date | null
  readonly created_at: Date
  readonly bound_email_revision: string | null
  readonly bound_credential_version: string | null
}): PasswordCredentialToken => ({
  id: row.id,
  userId: row.user_id,
  purpose: row.purpose,
  tokenHash: row.token_hash,
  tokenKeyVersion: row.token_key_version,
  attemptCount: row.attempt_count,
  expiresAt: row.expires_at,
  consumedAt: row.consumed_at,
  createdAt: row.created_at,
  binding:
    row.bound_email_revision !== null && row.bound_credential_version !== null
      ? { emailRevision: row.bound_email_revision, credentialVersion: row.bound_credential_version }
      : null,
})

export const createPasswordTokenRepository = (): PasswordTokenRepository => ({
  create: async (tx, input) => {
    const row = await tx
      .insertInto("password_credential_tokens")
      .values({
        user_id: input.userId,
        purpose: input.purpose,
        token_hash: input.tokenHash,
        token_key_version: input.tokenKeyVersion,
        expires_at: input.expiresAt,
        bound_email_revision: input.binding.emailRevision,
        bound_credential_version: input.binding.credentialVersion,
      })
      .returningAll()
      .executeTakeFirstOrThrow()
    return mapToken(row)
  },

  lockActive: async (tx, userId) => {
    const row = await tx
      .selectFrom("password_credential_tokens")
      .selectAll()
      .where("user_id", "=", userId)
      .where("consumed_at", "is", null)
      .forUpdate()
      .executeTakeFirst()
    return row === undefined ? null : mapToken(row)
  },

  findActiveByHash: async (tx, tokenHash) => {
    const row = await tx
      .selectFrom("password_credential_tokens")
      .selectAll()
      .where("token_hash", "=", tokenHash)
      .where("consumed_at", "is", null)
      .executeTakeFirst()
    return row === undefined ? null : mapToken(row)
  },

  lockActiveByHash: async (tx, tokenHash) => {
    const row = await tx
      .selectFrom("password_credential_tokens")
      .selectAll()
      .where("token_hash", "=", tokenHash)
      .where("consumed_at", "is", null)
      .forUpdate()
      .executeTakeFirst()
    return row === undefined ? null : mapToken(row)
  },

  latestCreatedAt: async (tx, userId) => {
    const row = await tx
      .selectFrom("password_credential_tokens")
      .select("created_at")
      .where("user_id", "=", userId)
      .orderBy("created_at", "desc")
      .limit(1)
      .executeTakeFirst()
    return row === undefined ? null : new Date(row.created_at)
  },

  findValidityContext: async (tx, tokenId) => {
    const row = await tx
      .selectFrom("password_credential_tokens as t")
      .innerJoin("users as u", "u.id", "t.user_id")
      .leftJoin("user_credentials as c", "c.user_id", "t.user_id")
      .select([
        "t.id as token_id",
        "t.user_id",
        "t.purpose",
        "t.expires_at",
        "t.consumed_at",
        "t.bound_email_revision",
        "t.bound_credential_version",
        "u.account_state",
        "u.email_revision",
        "c.version as credential_version",
        sql<boolean>`c.password_hash is not null`.as("has_password"),
      ])
      .where("t.id", "=", tokenId)
      .executeTakeFirst()
    if (row === undefined) return null
    return {
      token: {
        id: row.token_id,
        userId: row.user_id,
        purpose: row.purpose,
        expiresAt: row.expires_at,
        consumedAt: row.consumed_at,
        binding:
          row.bound_email_revision !== null && row.bound_credential_version !== null
            ? { emailRevision: row.bound_email_revision, credentialVersion: row.bound_credential_version }
            : null,
      },
      user: { account_state: row.account_state, email_revision: row.email_revision },
      credential:
        row.credential_version === null
          ? null
          : { version: row.credential_version, hasPassword: row.has_password },
    }
  },

  findLatestLink: async (tx, userId) => {
    const row = await tx
      .selectFrom("password_credential_tokens as t")
      .leftJoin("outbox_events as o", (join) =>
        join.on("o.deduplication_key", "=", sql<string>`'password_link:' || t.id::text`),
      )
      .leftJoin("email_deliveries as d", "d.outbox_event_id", "o.id")
      .select([
        "t.id as token_id",
        "t.purpose",
        "t.created_at",
        "t.expires_at",
        "t.consumed_at",
        "d.id as delivery_id",
        "d.state as delivery_state",
        "d.last_error_code",
        "d.sent_at",
        "d.updated_at as delivery_updated_at",
      ])
      .where("t.user_id", "=", userId)
      .orderBy("t.created_at", "desc")
      .orderBy("t.id", "desc")
      .limit(1)
      .executeTakeFirst()
    if (row === undefined) return null
    return {
      tokenId: row.token_id,
      purpose: row.purpose,
      createdAt: new Date(row.created_at),
      expiresAt: new Date(row.expires_at),
      consumedAt: row.consumed_at === null ? null : new Date(row.consumed_at),
      delivery:
        row.delivery_id === null || row.delivery_state === null || row.delivery_updated_at === null
          ? null
          : {
              deliveryId: row.delivery_id,
              state: row.delivery_state,
              lastErrorCode: row.last_error_code,
              sentAt: row.sent_at === null ? null : new Date(row.sent_at),
              updatedAt: new Date(row.delivery_updated_at),
            },
    }
  },

  consumeActive: async (tx, input) => {
    await tx
      .updateTable("password_credential_tokens")
      .set({ consumed_at: input.now })
      .where("user_id", "=", input.userId)
      .where("consumed_at", "is", null)
      .execute()
  },

  consume: async (tx, input) => {
    const result = await tx
      .updateTable("password_credential_tokens")
      .set({ consumed_at: input.now })
      .where("id", "=", input.tokenId)
      .where("consumed_at", "is", null)
      .executeTakeFirst()
    return Number(result.numUpdatedRows) === 1
  },

  incrementAttempt: async (tx, tokenId) => {
    await tx
      .updateTable("password_credential_tokens")
      .set({ attempt_count: sql<number>`attempt_count + 1` })
      .where("id", "=", tokenId)
      .execute()
  },
})
