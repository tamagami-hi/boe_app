/**
 * Admin content repository (spec 03 §4.5, §7): the versioned marketing/site
 * catalogue the admin console owns — FAQ content
 * items, and the application configuration.
 *
 * Lifecycle rules enforced here rather than in SQL triggers:
 *   - a row is created as `draft` at the next free version for its key;
 *   - publishing archives any currently published row for the same key first, so
 *     the partial unique index (one published per key) can never be violated;
 *   - `DELETE` from the console is an archive, never a row removal — published
 *     history stays auditable.
 *
 * Money is `bigint` paise and crosses this boundary as a string. Presentation
 * attributes live in the `payload` jsonb added by migration 020.
 */
import { sql } from "kysely"

import type { AppConfigVersion, ContentItem, Transaction } from "../db/repositories.js"

export type ContentState = "draft" | "published" | "archived"

export interface ContentPageQuery {
  readonly afterCreatedAt?: Date
  readonly afterId?: string
  /** validated 1..MAX_ADMIN_LIMIT, already incremented for hasMore probing */
  readonly limit: number
}

export interface InsertContentItemInput {
  readonly contentKey: string
  readonly kind: "faq" | "static_page" | "legal_disclosure"
  readonly version: number
  readonly title: string
  readonly body: string
  readonly payload: Readonly<Record<string, unknown>>
}

export interface UpdateContentItemInput {
  readonly title: string
  readonly body: string
  readonly payload: Readonly<Record<string, unknown>>
}

export interface PublishInput {
  readonly id: string
  readonly state: ContentState
  readonly publishedByUserId: string
  readonly now: Date
}

export interface InsertAppConfigInput {
  readonly version: number
  readonly payload: Readonly<Record<string, unknown>>
  readonly contentSha256: Buffer
  readonly publishedByUserId: string
  readonly now: Date
}

export interface AdminContentRepository {
  // --- content items (FAQ + static pages) ---
  listContentItems: (
    tx: Transaction,
    kind: string,
    query: ContentPageQuery,
  ) => Promise<readonly ContentItem[]>
  findContentItem: (tx: Transaction, id: string) => Promise<ContentItem | null>
  lockContentItem: (tx: Transaction, id: string) => Promise<ContentItem | null>
  contentKeyExists: (tx: Transaction, contentKey: string) => Promise<boolean>
  insertContentItem: (tx: Transaction, input: InsertContentItemInput) => Promise<ContentItem>
  updateContentItem: (tx: Transaction, id: string, input: UpdateContentItemInput) => Promise<ContentItem>
  setContentItemState: (tx: Transaction, input: PublishInput) => Promise<ContentItem>
  archivePublishedContentItems: (
    tx: Transaction,
    contentKey: string,
    exceptId: string,
    now: Date,
  ) => Promise<number>

  // --- app configuration ---
  findCurrentAppConfig: (tx: Transaction) => Promise<AppConfigVersion | null>
  maxAppConfigVersion: (tx: Transaction) => Promise<number>
  retireCurrentAppConfig: (tx: Transaction, now: Date) => Promise<void>
  insertAppConfigVersion: (tx: Transaction, input: InsertAppConfigInput) => Promise<AppConfigVersion>
}

const keysetClause = (query: ContentPageQuery, column: string) =>
  query.afterCreatedAt !== undefined && query.afterId !== undefined
    ? sql`and (${sql.raw(column)}.created_at < ${query.afterCreatedAt}
        or (${sql.raw(column)}.created_at = ${query.afterCreatedAt} and ${sql.raw(column)}.id < ${query.afterId}))`
    : sql``

export const createAdminContentRepository = (): AdminContentRepository => ({
  // --- content items ---
  listContentItems: async (tx, kind, query) => {
    const result = await sql<ContentItem>`
      select ci.* from content_items ci
      where ci.kind = ${kind} ${keysetClause(query, "ci")}
      order by ci.created_at desc, ci.id desc
      limit ${query.limit}
    `.execute(tx)
    return result.rows
  },

  findContentItem: async (tx, id) =>
    (await tx.selectFrom("content_items").selectAll().where("id", "=", id).executeTakeFirst()) ?? null,

  lockContentItem: async (tx, id) => {
    const result = await sql<ContentItem>`select * from content_items where id = ${id} for update`.execute(tx)
    return result.rows[0] ?? null
  },

  contentKeyExists: async (tx, contentKey) => {
    const row = await tx
      .selectFrom("content_items")
      .select("id")
      .where("content_key", "=", contentKey)
      .executeTakeFirst()
    return row !== undefined
  },

  insertContentItem: async (tx, input) =>
    tx
      .insertInto("content_items")
      .values({
        content_key: input.contentKey,
        kind: input.kind,
        version: input.version,
        title: input.title,
        body: input.body,
        payload: JSON.stringify(input.payload),
        state: "draft",
      })
      .returningAll()
      .executeTakeFirstOrThrow(),

  updateContentItem: async (tx, id, input) =>
    tx
      .updateTable("content_items")
      .set({
        title: input.title,
        body: input.body,
        payload: JSON.stringify(input.payload),
        updated_at: sql`now()`,
      })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirstOrThrow(),

  setContentItemState: async (tx, input) =>
    tx
      .updateTable("content_items")
      .set({
        state: input.state,
        published_by_user_id: input.state === "published" ? input.publishedByUserId : null,
        published_at: input.state === "published" ? input.now : null,
        archived_at: input.state === "archived" ? input.now : null,
        updated_at: sql`now()`,
      })
      .where("id", "=", input.id)
      .returningAll()
      .executeTakeFirstOrThrow(),

  archivePublishedContentItems: async (tx, contentKey, exceptId, now) => {
    const result = await tx
      .updateTable("content_items")
      .set({ state: "archived", archived_at: now, updated_at: sql`now()` })
      .where("content_key", "=", contentKey)
      .where("state", "=", "published")
      .where("id", "<>", exceptId)
      .executeTakeFirst()
    return Number(result.numUpdatedRows)
  },

  // --- app configuration ---
  findCurrentAppConfig: async (tx) =>
    (await tx
      .selectFrom("app_config_versions")
      .selectAll()
      .where("retired_at", "is", null)
      .orderBy("version", "desc")
      .executeTakeFirst()) ?? null,

  maxAppConfigVersion: async (tx) => {
    const result = await sql<{ max: number }>`
      select coalesce(max(version), 0) as "max" from app_config_versions
    `.execute(tx)
    return Number(result.rows[0]?.max ?? 0)
  },

  retireCurrentAppConfig: async (tx, now) => {
    await tx
      .updateTable("app_config_versions")
      .set({ retired_at: now })
      .where("retired_at", "is", null)
      .execute()
  },

  insertAppConfigVersion: async (tx, input) =>
    tx
      .insertInto("app_config_versions")
      .values({
        version: input.version,
        payload: JSON.stringify(input.payload),
        content_sha256: input.contentSha256,
        published_by_user_id: input.publishedByUserId,
        published_at: input.now,
      })
      .returningAll()
      .executeTakeFirstOrThrow(),
})
