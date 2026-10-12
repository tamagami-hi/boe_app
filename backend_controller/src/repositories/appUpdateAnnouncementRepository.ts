import { sql } from "kysely"

import type { Transaction } from "../db/repositories.js"

export interface AppUpdateAnnouncement {
  readonly id: string
  readonly version: string
  readonly versionCode: number
  readonly mandatory: boolean
  readonly message: string | null
  readonly downloadUrl: string
  readonly recipientCount: number
  readonly appConfigVersion: number | null
  readonly actorUserId: string
  readonly createdAt: Date
}

export type CreateAppUpdateAnnouncementInput = Omit<AppUpdateAnnouncement, "createdAt"> & Readonly<{ now: Date }>

export interface AnnouncementRecipient {
  readonly userId: string
  readonly email: string
  readonly emailRevision: string
}

export interface AppUpdateAnnouncementRepository {
  create: (tx: Transaction, input: CreateAppUpdateAnnouncementInput) => Promise<AppUpdateAnnouncement>
  findById: (tx: Transaction, announcementId: string) => Promise<AppUpdateAnnouncement | null>
  findSent: (
    tx: Transaction,
    input: Readonly<{ versionCode: number; mandatory: boolean }>,
  ) => Promise<AppUpdateAnnouncement | null>
  listRecipients: (tx: Transaction) => Promise<readonly AnnouncementRecipient[]>
  lockForSend: (tx: Transaction) => Promise<void>
}

interface AnnouncementRow {
  readonly id: string
  readonly version: string
  readonly version_code: number
  readonly mandatory: boolean
  readonly message: string | null
  readonly download_url: string
  readonly recipient_count: number
  readonly app_config_version: number | null
  readonly actor_user_id: string
  readonly created_at: Date
}

const toAnnouncement = (row: AnnouncementRow): AppUpdateAnnouncement => ({
  id: row.id,
  version: row.version,
  versionCode: row.version_code,
  mandatory: row.mandatory,
  message: row.message,
  downloadUrl: row.download_url,
  recipientCount: row.recipient_count,
  appConfigVersion: row.app_config_version,
  actorUserId: row.actor_user_id,
  createdAt: new Date(row.created_at),
})

export const createAppUpdateAnnouncementRepository = (): AppUpdateAnnouncementRepository => ({
  create: async (tx, input) =>
    toAnnouncement(
      await tx
        .insertInto("app_update_announcements")
        .values({
          id: input.id,
          version: input.version,
          version_code: input.versionCode,
          mandatory: input.mandatory,
          message: input.message,
          download_url: input.downloadUrl,
          recipient_count: input.recipientCount,
          app_config_version: input.appConfigVersion,
          actor_user_id: input.actorUserId,
          created_at: input.now,
        })
        .returningAll()
        .executeTakeFirstOrThrow(),
    ),

  findById: async (tx, announcementId) => {
    const row = await tx
      .selectFrom("app_update_announcements")
      .selectAll()
      .where("id", "=", announcementId)
      .executeTakeFirst()
    return row === undefined ? null : toAnnouncement(row)
  },

  findSent: async (tx, input) => {
    const row = await tx
      .selectFrom("app_update_announcements")
      .selectAll()
      .where("version_code", "=", input.versionCode)
      .where("mandatory", "=", input.mandatory)
      .executeTakeFirst()
    return row === undefined ? null : toAnnouncement(row)
  },

  lockForSend: async (tx) => {
    await sql`select pg_advisory_xact_lock(hashtextextended('app_update_announcement', 0))`.execute(tx)
  },

  listRecipients: async (tx) => {
    const result = await sql<{ id: string; email_normalized: string; email_revision: string }>`
      select u.id, u.email_normalized, u.email_revision
      from users u
      where u.account_state = 'active'
        and u.pii_tombstoned_at is null
        and not exists (
          select 1 from user_roles ur where ur.user_id = u.id and ur.revoked_at is null
        )
      order by u.id
    `.execute(tx)
    return result.rows.map((row) => ({
      userId: row.id,
      email: row.email_normalized,
      emailRevision: String(row.email_revision),
    }))
  },
})
