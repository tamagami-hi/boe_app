/**
 * Admin content routes (spec 04 §3.2; spec 03 §4.5). Web-cookie transport with
 * RBAC permission checks; unsafe methods additionally require the synchronizer
 * CSRF token. Lists use the authenticated opaque keyset cursor.
 *
 *   GET/POST/PATCH/DELETE /v1/admin/faqs[/:id]    same lifecycle over content_items(kind='faq')
 *   GET    /v1/admin/app-config         the current (non-retired) configuration version
 *   PATCH  /v1/admin/app-config         publish a new version, retiring the current one
 *
 * Publishing is a two-step inside one transaction: archive whatever is published
 * for the same key, then publish this row. That keeps the "one published row per
 * key" partial unique indexes satisfiable without racing.
 *
 * `app_config_versions` carries presentation/feature-flag/minimum-version data
 * only. The schema is `strict()`, so the legacy console habit of embedding fund
 * and product catalogues in app config is rejected rather than silently stored.
 */
import { CACHE_KEYS, type Cache } from "../cache/cache.js"
import { createHash } from "node:crypto"

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { Kysely } from "kysely"
import { z } from "zod"

import type { UnitOfWork } from "../db/database.js"
import type { AppConfigVersion, ContentItem, IdempotencyRepository } from "../db/repositories.js"
import type { Database } from "../db/types.js"
import { requireAnyPermission, resolveAdminPrincipal } from "../domain/admin/adminAccess.js"
import type { WebAuthDeps } from "../domain/auth/webAuth.js"
import { AppError } from "../http/errorCatalog.js"
import { paginate, readKeyset } from "../http/pagination.js"
import { parseOrThrow } from "../http/validation.js"
import type { AdminContentRepository } from "../repositories/adminContentRepository.js"
import type { AuditWriteRepository } from "../repositories/auditRepository.js"
import {
  adminIdempotencyScope,
  computeFilterHash,
  hashRequest,
  iso,
  isoOrNull,
  limitSchema,
  optionalIdempotencyKey,
  reasonDetailSchema,
  runAdminMutation,
  uuidParam,
} from "./adminRouteKit.js"

export interface AdminContentConfig {
  readonly cursorKey: Buffer
  readonly idempotencyTtlMs: number
}

export interface AdminContentDeps {
  readonly webAuth: WebAuthDeps
  readonly unitOfWork: UnitOfWork
  readonly database: Kysely<Database>
  readonly clock: () => Date
  readonly config: AdminContentConfig
  readonly contentRepository: AdminContentRepository
  readonly auditRepository: AuditWriteRepository
  readonly idempotencyRepository: IdempotencyRepository
  readonly cache: Cache
}

const FAQS_ROUTE = "/v1/admin/faqs"
const APP_CONFIG_ROUTE = "/v1/admin/app-config"

/** Wire cadence -> canonical billing period. `one_time` bills once, so 1 month. */

// --- schemas ---

const statusEnum = z.enum(["draft", "published", "archived"])
const listQuerySchema = z.object({ after: z.string().min(1).optional(), limit: limitSchema }).strict()
const statusPatchSchema = z.object({ status: statusEnum }).strict()
const sortOrderSchema = z.coerce.number().int().min(0).max(100000).default(0)
const shortText = z.string().trim().max(200)
const longText = z.string().trim().max(8000)

const faqFieldsSchema = z
  .object({
    question: longText.min(1),
    answer: longText.min(1),
    category: shortText.default("general"),
    order: sortOrderSchema,
  })
  .strict()

const semverish = z
  .string()
  .trim()
  .max(32)
  .regex(/^[0-9]+(?:\.[0-9]+){0,3}$/u, "must be a dotted numeric version")

const appConfigPayloadSchema = z
  .object({
    featureFlags: z.record(z.string().max(80), z.boolean()).default({}),
    minimumSupportedVersion: z
      .object({ android: semverish.optional(), ios: semverish.optional(), web: semverish.optional() })
      .strict()
      .default({}),
    downloads: z
      .object({
        androidUrl: z.string().url().max(2048).optional(),
        iosUrl: z.string().url().max(2048).optional(),
      })
      .strict()
      .default({}),
    maintenance: z
      .object({ enabled: z.boolean().default(false), message: longText.optional() })
      .strict()
      .default({ enabled: false }),
    presentation: z
      .record(z.string().max(80), z.union([z.string().max(500), z.number(), z.boolean()]))
      .default({}),
  })
  .strict()

const appConfigPatchSchema = z
  .object({ config: appConfigPayloadSchema, reason: reasonDetailSchema.optional() })
  .strict()

// --- payload helpers ---

type JsonRecord = Readonly<Record<string, unknown>>

const readPayload = (value: unknown): JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {}

const text = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback)
const count = (value: unknown, fallback = 0): number => (typeof value === "number" ? value : fallback)

// --- wire mappers (the admin console contract) ---

const mapFaq = (row: ContentItem): Record<string, unknown> => {
  const payload = readPayload(row.payload)
  return {
    id: row.id,
    contentKey: row.content_key,
    question: row.title,
    answer: row.body,
    category: text(payload.category, "general"),
    order: count(payload.order),
    status: row.state,
    version: row.version,
    publishedAt: isoOrNull(row.published_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  }
}

const mapAppConfig = (row: AppConfigVersion | null): Record<string, unknown> =>
  row === null
    ? { version: null, config: null, publishedAt: null, publishedBy: null }
    : {
        version: row.version,
        config: readPayload(row.payload),
        publishedAt: iso(row.published_at),
        publishedBy: row.published_by_user_id,
        contentSha256: Buffer.from(row.content_sha256 as unknown as Uint8Array).toString("hex"),
      }

/** Stable content key for a new FAQ, de-duplicated against existing keys. */
const faqContentKey = (question: string): string => {
  const base = question
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48)
  const digest = createHash("sha256").update(question).digest("hex").slice(0, 8)
  return `faq-${base === "" ? "item" : base}-${digest}`
}

// --- generic list/mutation plumbing ---

interface ListedRow {
  readonly id: string
  readonly created_at: Date | string
}

const listCollection = async <Row extends ListedRow>(
  deps: AdminContentDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  route: string,
  permissions: readonly string[],
  load: (limit: number, keyset: ReturnType<typeof readKeyset>) => Promise<readonly Row[]>,
  map: (row: Row) => Record<string, unknown>,
) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, permissions)
  const query = parseOrThrow(listQuerySchema, request.query)
  const now = deps.clock()
  const filterHash = computeFilterHash({})
  const keyset = readKeyset(deps.config.cursorKey, query.after, route, filterHash, now)
  const rows = await load(query.limit + 1, keyset)
  const { items, page } = paginate(
    deps.config.cursorKey,
    rows,
    query.limit,
    route,
    filterHash,
    now,
    (row) => [iso(row.created_at), row.id],
  )
  return reply.sendData({ items: items.map(map) }, { status: 200, page })
}

/**
 * Run a content mutation. When the console sends an `Idempotency-Key` the write
 * goes through the database idempotency protocol so a replay returns the first
 * committed result; without one it is a plain single transaction (the console's
 * editors do not send keys, and a replayed *state flip* must not be swallowed).
 */
const mutate = async <TBody extends Record<string, unknown>>(
  deps: AdminContentDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  routeTemplate: string,
  method: "POST" | "PATCH" | "DELETE",
  canonical: Readonly<Record<string, unknown>>,
  principalUserId: string,
  execute: (tx: Parameters<Parameters<UnitOfWork["execute"]>[0]>[0]) => Promise<{ status: number; body: TBody }>,
) => {
  const key = optionalIdempotencyKey(request)
  const now = deps.clock()
  if (key === null) {
    const outcome = await deps.unitOfWork.execute((tx) => execute(tx))
    return reply.sendData(outcome.body, { status: outcome.status })
  }
  const result = await runAdminMutation<TBody>({
    unitOfWork: deps.unitOfWork,
    idempotencyRepository: deps.idempotencyRepository,
    now,
    idempotencyTtlMs: deps.config.idempotencyTtlMs,
    scope: adminIdempotencyScope(principalUserId, routeTemplate, key, method),
    requestHash: hashRequest(canonical),
    execute,
  })
  return reply.sendData(result.body, {
    status: result.status,
    ...(result.replay ? { idempotencyReplay: true } : {}),
  })
}

const createFaq = async (deps: AdminContentDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, ["content.publish"])
  const body = parseOrThrow(faqFieldsSchema, request.body)

  return mutate(
    deps,
    request,
    reply,
    FAQS_ROUTE,
    "POST",
    { question: body.question, category: body.category },
    principal.userId,
    async (tx) => {
      let contentKey = faqContentKey(body.question)
      // Two FAQs may legitimately share a question digest collision window; the
      // key only needs to be unique, so disambiguate rather than fail the edit.
      for (let attempt = 2; await deps.contentRepository.contentKeyExists(tx, contentKey); attempt += 1) {
        contentKey = `${faqContentKey(body.question)}-${attempt}`
        if (attempt > 20) throw new AppError("STATE_CONFLICT")
      }
      const item = await deps.contentRepository.insertContentItem(tx, {
        contentKey,
        kind: "faq",
        version: 1,
        title: body.question,
        body: body.answer,
        payload: { category: body.category, order: body.order },
      })
      await deps.auditRepository.append(tx, {
        actorType: "admin",
        actorUserId: principal.userId,
        command: "content_item.created",
        entityType: "content_item",
        entityId: item.id,
        toState: item.state,
        requestId: request.requestId,
        entityVersion: item.version,
        metadata: { contentKey: item.content_key, kind: item.kind },
      })
      return { status: 201, body: { faq: mapFaq(item) } }
    },
  )
}

const setFaqState = async (deps: AdminContentDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, ["content.publish"])
  const faqId = parseOrThrow(uuidParam, (request.params as { faqId?: unknown }).faqId)
  const nextState = parseOrThrow(statusPatchSchema, request.body).status
  const now = deps.clock()

  return mutate(
    deps,
    request,
    reply,
    `${FAQS_ROUTE}/:faqId/status`,
    "PATCH",
    { faqId, status: nextState },
    principal.userId,
    async (tx) => {
      const existing = await deps.contentRepository.lockContentItem(tx, faqId)
      if (existing === null || existing.kind !== "faq") throw new AppError("RESOURCE_NOT_FOUND")

      if (nextState === "published") {
        await deps.contentRepository.archivePublishedContentItems(
          tx,
          existing.content_key,
          existing.id,
          now,
        )
      }
      const updated = await deps.contentRepository.setContentItemState(tx, {
        id: faqId,
        state: nextState,
        publishedByUserId: principal.userId,
        now,
      })
      await deps.auditRepository.append(tx, {
        actorType: "admin",
        actorUserId: principal.userId,
        command: `content_item.${nextState}`,
        entityType: "content_item",
        entityId: faqId,
        fromState: existing.state,
        toState: updated.state,
        requestId: request.requestId,
        entityVersion: updated.version,
        metadata: { contentKey: updated.content_key },
      })
      return { status: 200, body: { faq: mapFaq(updated) } }
    },
  )
}

const editFaq = async (deps: AdminContentDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, ["content.publish"])
  const faqId = parseOrThrow(uuidParam, (request.params as { faqId?: unknown }).faqId)
  const fields = parseOrThrow(faqFieldsSchema, request.body)

  return mutate(
    deps,
    request,
    reply,
    `${FAQS_ROUTE}/:faqId`,
    "PATCH",
    { faqId, question: fields.question },
    principal.userId,
    async (tx) => {
      const existing = await deps.contentRepository.lockContentItem(tx, faqId)
      if (existing === null || existing.kind !== "faq") throw new AppError("RESOURCE_NOT_FOUND")
      if (existing.state !== "draft") throw new AppError("STATE_CONFLICT")

      const updated = await deps.contentRepository.updateContentItem(tx, faqId, {
        title: fields.question,
        body: fields.answer,
        payload: { ...readPayload(existing.payload), category: fields.category, order: fields.order },
      })
      await deps.auditRepository.append(tx, {
        actorType: "admin",
        actorUserId: principal.userId,
        command: "content_item.updated",
        entityType: "content_item",
        entityId: faqId,
        fromState: existing.state,
        toState: updated.state,
        requestId: request.requestId,
        entityVersion: updated.version,
        metadata: { contentKey: updated.content_key },
      })
      return { status: 200, body: { faq: mapFaq(updated) } }
    },
  )
}

const archiveFaq = async (deps: AdminContentDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, ["content.publish"])
  const faqId = parseOrThrow(uuidParam, (request.params as { faqId?: unknown }).faqId)
  const now = deps.clock()

  return mutate(
    deps,
    request,
    reply,
    `${FAQS_ROUTE}/:faqId`,
    "DELETE",
    { faqId },
    principal.userId,
    async (tx) => {
      const existing = await deps.contentRepository.lockContentItem(tx, faqId)
      if (existing === null || existing.kind !== "faq") throw new AppError("RESOURCE_NOT_FOUND")
      const updated = await deps.contentRepository.setContentItemState(tx, {
        id: faqId,
        state: "archived",
        publishedByUserId: principal.userId,
        now,
      })
      await deps.auditRepository.append(tx, {
        actorType: "admin",
        actorUserId: principal.userId,
        command: "content_item.archived",
        entityType: "content_item",
        entityId: faqId,
        fromState: existing.state,
        toState: updated.state,
        requestId: request.requestId,
        entityVersion: updated.version,
        metadata: { contentKey: updated.content_key },
      })
      return { status: 200, body: { faq: mapFaq(updated) } }
    },
  )
}

// --- app config ---

const getAppConfig = async (deps: AdminContentDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, ["config.read", "config.publish"])
  const current = await deps.contentRepository.findCurrentAppConfig(deps.database)
  return reply.sendData(mapAppConfig(current), { status: 200 })
}

const publishAppConfig = async (deps: AdminContentDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, ["config.publish"])
  const body = parseOrThrow(appConfigPatchSchema, request.body)
  const now = deps.clock()
  const canonicalPayload = JSON.stringify(body.config)
  const contentSha256 = createHash("sha256").update(canonicalPayload).digest()

  return mutate(
    deps,
    request,
    reply,
    APP_CONFIG_ROUTE,
    "PATCH",
    { config: body.config },
    principal.userId,
    async (tx) => {
      const previous = await deps.contentRepository.findCurrentAppConfig(tx)
      const nextVersion = (await deps.contentRepository.maxAppConfigVersion(tx)) + 1
      await deps.contentRepository.retireCurrentAppConfig(tx, now)
      const published = await deps.contentRepository.insertAppConfigVersion(tx, {
        version: nextVersion,
        payload: body.config,
        contentSha256,
        publishedByUserId: principal.userId,
        now,
      })
      await deps.auditRepository.append(tx, {
        actorType: "admin",
        actorUserId: principal.userId,
        command: "app_config.published",
        entityType: "app_config_version",
        entityId: published.id,
        fromState: previous === null ? null : String(previous.version),
        toState: String(published.version),
        requestId: request.requestId,
        entityVersion: published.version,
        metadata: {
          version: published.version,
          ...(body.reason === undefined ? {} : { reason: body.reason }),
        },
      })
      return { status: 200, body: mapAppConfig(published) }
    },
  )
}

export const registerAdminContentRoutes = (
  application: FastifyInstance,
  deps: AdminContentDeps,
): void => {
  application.get(FAQS_ROUTE, async (request, reply) =>
    listCollection(
      deps,
      request,
      reply,
      FAQS_ROUTE,
      ["content.read", "content.publish"],
      async (limit, keyset) =>
        deps.contentRepository.listContentItems(deps.database, "faq", { ...keyset, limit }),
      mapFaq,
    ),
  )
  application.post(FAQS_ROUTE, async (request, reply) => createFaq(deps, request, reply))
  application.patch(`${FAQS_ROUTE}/:faqId`, async (request, reply) => editFaq(deps, request, reply))
  application.patch(`${FAQS_ROUTE}/:faqId/status`, async (request, reply) => {
    const result = await setFaqState(deps, request, reply)
    await deps.cache.invalidate([CACHE_KEYS.supportFaqs])
    return result
  })
  application.delete(`${FAQS_ROUTE}/:faqId`, async (request, reply) => {
    const result = await archiveFaq(deps, request, reply)
    await deps.cache.invalidate([CACHE_KEYS.supportFaqs])
    return result
  })

  application.get(APP_CONFIG_ROUTE, async (request, reply) => getAppConfig(deps, request, reply))
  application.patch(APP_CONFIG_ROUTE, async (request, reply) => {
    const result = await publishAppConfig(deps, request, reply)
    await deps.cache.invalidate([CACHE_KEYS.appConfig])
    return result
  })
}
