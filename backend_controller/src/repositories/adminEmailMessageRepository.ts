import type { Transaction } from "../db/repositories.js"

export interface AdminEmailMessage {
  readonly id: string
  readonly templateId: string
  readonly templateRevision: number
  readonly recipientUserId: string
  readonly actorUserId: string
  readonly isTest: boolean
  readonly boundEmailRevision: string
  readonly deliveryId: string
  readonly createdAt: Date
}

export type CreateAdminEmailMessageInput = Omit<AdminEmailMessage, "createdAt"> & Readonly<{ now: Date }>

export interface AdminEmailMessageRepository {
  create: (tx: Transaction, input: CreateAdminEmailMessageInput) => Promise<AdminEmailMessage>
  findById: (tx: Transaction, messageId: string) => Promise<AdminEmailMessage | null>
  latestCreatedAt: (
    tx: Transaction,
    input: Readonly<{ recipientUserId: string; isTest: boolean }>,
  ) => Promise<Date | null>
}

interface MessageRow {
  readonly id: string
  readonly template_id: string
  readonly template_revision: number
  readonly recipient_user_id: string
  readonly actor_user_id: string
  readonly is_test: boolean
  readonly bound_email_revision: string
  readonly delivery_id: string
  readonly created_at: Date
}

const toMessage = (row: MessageRow): AdminEmailMessage => ({
  id: row.id,
  templateId: row.template_id,
  templateRevision: row.template_revision,
  recipientUserId: row.recipient_user_id,
  actorUserId: row.actor_user_id,
  isTest: row.is_test,
  boundEmailRevision: String(row.bound_email_revision),
  deliveryId: row.delivery_id,
  createdAt: new Date(row.created_at),
})

export const createAdminEmailMessageRepository = (): AdminEmailMessageRepository => ({
  create: async (tx, input) =>
    toMessage(
      await tx
        .insertInto("admin_email_messages")
        .values({
          id: input.id,
          template_id: input.templateId,
          template_revision: input.templateRevision,
          recipient_user_id: input.recipientUserId,
          actor_user_id: input.actorUserId,
          is_test: input.isTest,
          bound_email_revision: input.boundEmailRevision,
          delivery_id: input.deliveryId,
          created_at: input.now,
        })
        .returningAll()
        .executeTakeFirstOrThrow(),
    ),

  findById: async (tx, messageId) => {
    const row = await tx.selectFrom("admin_email_messages").selectAll().where("id", "=", messageId).executeTakeFirst()
    return row === undefined ? null : toMessage(row)
  },

  latestCreatedAt: async (tx, input) => {
    const row = await tx
      .selectFrom("admin_email_messages")
      .select("created_at")
      .where("recipient_user_id", "=", input.recipientUserId)
      .where("is_test", "=", input.isTest)
      .orderBy("created_at", "desc")
      .limit(1)
      .executeTakeFirst()
    return row === undefined ? null : new Date(row.created_at)
  },
})
