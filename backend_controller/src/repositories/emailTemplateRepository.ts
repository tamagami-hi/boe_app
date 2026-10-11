import { sql } from "kysely"

import type { Transaction } from "../db/repositories.js"

export interface EmailTemplateRevision {
  readonly templateId: string
  readonly revision: number
  readonly subject: string
  readonly body: string
  readonly createdByUserId: string | null
  readonly createdAt: Date
}

export interface EmailTemplate {
  readonly id: string
  readonly slug: string
  readonly name: string
  readonly description: string
  readonly preloaded: boolean
  readonly currentRevision: number
  readonly archivedAt: Date | null
  readonly createdAt: Date
  readonly updatedAt: Date
  readonly version: string
  readonly current: EmailTemplateRevision
}

export interface CreateTemplateInput {
  readonly slug: string
  readonly name: string
  readonly description: string
  readonly subject: string
  readonly body: string
  readonly actorUserId: string
  readonly now: Date
}

export interface ReviseTemplateInput {
  readonly templateId: string
  readonly expectedVersion: string
  readonly name: string
  readonly description: string
  readonly subject: string
  readonly body: string
  readonly actorUserId: string
  readonly now: Date
}

export interface EmailTemplateRepository {
  list: (tx: Transaction, input: Readonly<{ includeArchived: boolean }>) => Promise<readonly EmailTemplate[]>
  findById: (tx: Transaction, templateId: string) => Promise<EmailTemplate | null>
  findBySlug: (tx: Transaction, slug: string) => Promise<EmailTemplate | null>
  findRevision: (tx: Transaction, templateId: string, revision: number) => Promise<EmailTemplateRevision | null>
  listRevisions: (tx: Transaction, templateId: string, limit: number) => Promise<readonly EmailTemplateRevision[]>
  create: (tx: Transaction, input: CreateTemplateInput) => Promise<EmailTemplate>
  revise: (tx: Transaction, input: ReviseTemplateInput) => Promise<EmailTemplate | null>
  setArchived: (
    tx: Transaction,
    input: Readonly<{ templateId: string; expectedVersion: string; archived: boolean; now: Date }>,
  ) => Promise<EmailTemplate | null>
}

interface JoinedRow {
  readonly id: string
  readonly slug: string
  readonly name: string
  readonly description: string
  readonly preloaded: boolean
  readonly current_revision: number
  readonly archived_at: Date | null
  readonly created_at: Date
  readonly updated_at: Date
  readonly version: string
  readonly subject: string
  readonly body: string
  readonly revision_created_by: string | null
  readonly revision_created_at: Date
}

const toRevision = (row: {
  readonly template_id: string
  readonly revision: number
  readonly subject: string
  readonly body: string
  readonly created_by_user_id: string | null
  readonly created_at: Date
}): EmailTemplateRevision => ({
  templateId: row.template_id,
  revision: row.revision,
  subject: row.subject,
  body: row.body,
  createdByUserId: row.created_by_user_id,
  createdAt: new Date(row.created_at),
})

const toTemplate = (row: JoinedRow): EmailTemplate => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  description: row.description,
  preloaded: row.preloaded,
  currentRevision: row.current_revision,
  archivedAt: row.archived_at === null ? null : new Date(row.archived_at),
  createdAt: new Date(row.created_at),
  updatedAt: new Date(row.updated_at),
  version: String(row.version),
  current: {
    templateId: row.id,
    revision: row.current_revision,
    subject: row.subject,
    body: row.body,
    createdByUserId: row.revision_created_by,
    createdAt: new Date(row.revision_created_at),
  },
})

const joined = (tx: Transaction) =>
  tx
    .selectFrom("email_templates as t")
    .innerJoin("email_template_revisions as r", (join) =>
      join.onRef("r.template_id", "=", "t.id").onRef("r.revision", "=", "t.current_revision"),
    )
    .select([
      "t.id",
      "t.slug",
      "t.name",
      "t.description",
      "t.preloaded",
      "t.current_revision",
      "t.archived_at",
      "t.created_at",
      "t.updated_at",
      "t.version",
      "r.subject",
      "r.body",
      "r.created_by_user_id as revision_created_by",
      "r.created_at as revision_created_at",
    ])

export const createEmailTemplateRepository = (): EmailTemplateRepository => {
  const findById = async (tx: Transaction, templateId: string): Promise<EmailTemplate | null> => {
    const row = await joined(tx).where("t.id", "=", templateId).executeTakeFirst()
    return row === undefined ? null : toTemplate(row)
  }

  return {
    list: async (tx, input) => {
      let query = joined(tx).orderBy("t.preloaded", "desc").orderBy("t.name", "asc")
      if (!input.includeArchived) query = query.where("t.archived_at", "is", null)
      return (await query.execute()).map(toTemplate)
    },

    findById,

    findBySlug: async (tx, slug) => {
      const row = await joined(tx).where("t.slug", "=", slug).executeTakeFirst()
      return row === undefined ? null : toTemplate(row)
    },

    findRevision: async (tx, templateId, revision) => {
      const row = await tx
        .selectFrom("email_template_revisions")
        .selectAll()
        .where("template_id", "=", templateId)
        .where("revision", "=", revision)
        .executeTakeFirst()
      return row === undefined ? null : toRevision(row)
    },

    listRevisions: async (tx, templateId, limit) =>
      (
        await tx
          .selectFrom("email_template_revisions")
          .selectAll()
          .where("template_id", "=", templateId)
          .orderBy("revision", "desc")
          .limit(limit)
          .execute()
      ).map(toRevision),

    create: async (tx, input) => {
      const template = await tx
        .insertInto("email_templates")
        .values({
          slug: input.slug,
          name: input.name,
          description: input.description,
          created_by_user_id: input.actorUserId,
          created_at: input.now,
          updated_at: input.now,
        })
        .returning("id")
        .executeTakeFirstOrThrow()
      await tx
        .insertInto("email_template_revisions")
        .values({
          template_id: template.id,
          revision: 1,
          subject: input.subject,
          body: input.body,
          created_by_user_id: input.actorUserId,
          created_at: input.now,
        })
        .execute()
      const created = await findById(tx, template.id)
      if (created === null) throw new Error("created template not readable")
      return created
    },

    revise: async (tx, input) => {
      const updated = await tx
        .updateTable("email_templates")
        .set({
          name: input.name,
          description: input.description,
          current_revision: sql<number>`current_revision + 1`,
          updated_at: input.now,
          version: sql<string>`version + 1`,
        })
        .where("id", "=", input.templateId)
        .where("version", "=", input.expectedVersion)
        .where("archived_at", "is", null)
        .returning(["id", "current_revision"])
        .executeTakeFirst()
      if (updated === undefined) return null
      await tx
        .insertInto("email_template_revisions")
        .values({
          template_id: input.templateId,
          revision: updated.current_revision,
          subject: input.subject,
          body: input.body,
          created_by_user_id: input.actorUserId,
          created_at: input.now,
        })
        .execute()
      return findById(tx, input.templateId)
    },

    setArchived: async (tx, input) => {
      const updated = await tx
        .updateTable("email_templates")
        .set({
          archived_at: input.archived ? input.now : null,
          updated_at: input.now,
          version: sql<string>`version + 1`,
        })
        .where("id", "=", input.templateId)
        .where("version", "=", input.expectedVersion)
        .returning("id")
        .executeTakeFirst()
      return updated === undefined ? null : findById(tx, input.templateId)
    },
  }
}
