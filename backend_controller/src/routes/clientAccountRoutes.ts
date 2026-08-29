/**
 * Client account routes — the surfaces the app needs beside the money model.
 * Native bearer transport; every handler re-resolves the principal, so a
 * suspended or closed account reads nothing.
 *
 *   GET   /v1/client/notifications        the inbox
 *   PATCH /v1/client/notifications/:id    mark one read
 *   GET   /v1/client/payments             payment history, optionally by state
 *   GET   /v1/client/statements           monthly statements derived from the ledger
 *   GET   /v1/client/support/faqs         published FAQ content
 *   GET   /v1/client/support/tickets      the investor's own support requests
 *   POST  /v1/client/support/tickets      raise one
 *   GET   /v1/client/research-context     published research/market context
 *
 * Statements are derived per read from the client value ledger rather than stored,
 * for the same reason the dashboard is: one source of truth means a statement can
 * never disagree with the live figures.
 */
import { randomUUID } from "node:crypto"

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { Kysely } from "kysely"
import { z } from "zod"

import type { UnitOfWork } from "../db/database.js"
import type { Database, PaymentState } from "../db/types.js"
import { resolveClientPrincipal, type ClientRequestAuthDeps } from "../domain/auth/clientWebAuth.js"
import { projectPaymentStatus } from "../domain/client/clientStatus.js"
import { toLedgerEntries } from "../domain/client/portfolioProjection.js"
import { deriveStatements } from "../domain/client/statements.js"
import { computeFilterHash } from "../http/cursor.js"
import { AppError } from "../http/errorCatalog.js"
import { paginate, readKeyset } from "../http/pagination.js"
import { parseOrThrow } from "../http/validation.js"
import type { AuditWriteRepository } from "../repositories/auditRepository.js"
import type {
  ClientAccountRepository,
  ClientPaymentRow,
  ContentDocumentRow,
  NotificationRow,
  SupportRequestRow,
} from "../repositories/clientAccountRepository.js"
import type { ClientValueEntryRepository } from "../repositories/clientValueEntryRepository.js"
import type { NotificationWriteRepository } from "../repositories/notificationRepository.js"
import { reconcileAppVersion } from "../domain/client/reconcileAppVersion.js"
import { latestPublishedBuild } from "./publicAppRoutes.js"

export interface ClientAccountConfig {
  readonly cursorKey: Buffer
}

export interface ClientAccountDeps extends ClientRequestAuthDeps {
  readonly clientAccountRepository: ClientAccountRepository
  readonly clientValueEntryRepository: ClientValueEntryRepository
  readonly auditRepository: AuditWriteRepository
  readonly notificationRepository: NotificationWriteRepository
  readonly unitOfWork: UnitOfWork
  readonly database: Kysely<Database>
  readonly clock: () => Date
  readonly config: ClientAccountConfig
  /**
   * Where published APKs live, shared with the public update feed so the inbox
   * and the launch dialog can never disagree about what "newest" is. Optional:
   * without it the version report simply reconciles against "nothing published".
   */
  readonly appUpdate?: {
    readonly releaseRoot: string | null
    readonly downloadBaseUrl: string | null
  }
}

const NOTIFICATIONS_ROUTE = "/v1/client/notifications"
const APP_VERSION_ROUTE = "/v1/client/app-version"
const PAYMENTS_ROUTE = "/v1/client/payments"
const STATEMENTS_ROUTE = "/v1/client/statements"
const FAQS_ROUTE = "/v1/client/support/faqs"
const TICKETS_ROUTE = "/v1/client/support/tickets"
const RESEARCH_ROUTE = "/v1/client/research-context"

/** Content keys the app reads; published rows only. */
const RESEARCH_CONTENT_KEY = "research-context"

const MAX_ITEMS = 200
const MAX_PAGE_ITEMS = 100
const DEFAULT_PAGE_ITEMS = 25

/**
 * Paged reads share one limit ceiling with every other list so a page always
 * fits inside what a cursor can describe. `MAX_ITEMS` stays for the unpaged
 * content reads (FAQs), which are a bounded editorial set, not a queue.
 */
const limitSchema = z.coerce.number().int().min(1).max(MAX_PAGE_ITEMS).default(DEFAULT_PAGE_ITEMS)
const cursorSchema = z.string().min(1).optional()

export const listQuerySchema = z.object({ after: cursorSchema, limit: limitSchema }).strict()
const uuidParam = z.string().uuid()

/**
 * What the app reports about itself on each launch. `variant` is a closed set
 * because it becomes a directory name; `applicationId` scopes the lookup to
 * builds that could actually install over the caller (dev and prod APKs are
 * signed differently).
 */
const appVersionSchema = z
  .object({
    platform: z.enum(["android"]).default("android"),
    variant: z.enum(["client", "admin"]).default("client"),
    applicationId: z.string().trim().min(1).max(200),
    versionName: z.string().trim().min(1).max(64),
    versionCode: z.coerce.number().int().min(0).max(2_000_000_000),
  })
  .strict()

const PAYMENT_STATES = [
  "created",
  "provider_pending",
  "succeeded",
  "failed",
  "expired",
  "reconciliation_required",
  "refund_pending",
  "refund_failed",
  "refunded",
] as const satisfies readonly PaymentState[]

/**
 * The app asks for groups of states in one call (`pending`, `settled`, `failed`
 * tabs), so the filter is a comma-separated list. Aliases keep the client from
 * having to know the storage vocabulary.
 */
const STATE_ALIASES: Readonly<Record<string, readonly PaymentState[]>> = {
  pending: ["created", "provider_pending"],
  gateway_initiated: ["provider_pending"],
  success: ["succeeded"],
  confirmed: ["succeeded"],
  reconciled: ["succeeded"],
  rejected: ["failed"],
  refund_in_progress: ["refund_pending"],
  support_required: ["reconciliation_required", "refund_failed"],
  payment_in_progress: ["created", "provider_pending"],
  processing: ["succeeded"],
  payment_failed: ["failed", "expired"],
  refunded: ["refunded"],
}

export const parsePaymentStates = (raw: string | readonly string[] | undefined): readonly PaymentState[] => {
  if (raw === undefined) return []
  const tokens: readonly string[] = typeof raw === "string" ? raw.split(",") : raw
  const requested = tokens.map((part) => part.trim().toLowerCase()).filter((part) => part !== "")
  const resolved = new Set<PaymentState>()
  for (const token of requested) {
    const alias = STATE_ALIASES[token]
    if (alias !== undefined) {
      for (const state of alias) resolved.add(state)
      continue
    }
    const known = PAYMENT_STATES.find((state) => state === token)
    if (known === undefined) {
      throw new AppError("VALIDATION_FAILED", { fields: { status: [`unknown payment state '${token}'`] } })
    }
    resolved.add(known)
  }
  return [...resolved]
}

export const paymentSuccessProjectionFor = (
  raw: string | readonly string[] | undefined,
): "confirmed" | "processing" | null => {
  if (raw === undefined) return null
  const values = (typeof raw === "string" ? raw.split(",") : raw).map((value) => value.trim().toLowerCase())
  const hasConfirmed = values.includes("confirmed")
  const hasProcessing = values.includes("processing")
  if (hasConfirmed === hasProcessing) return null
  return hasConfirmed ? "confirmed" : "processing"
}

export const paymentsQuerySchema = z
  .object({
    status: z.union([z.string(), z.array(z.string())]).optional(),
    after: cursorSchema,
    limit: limitSchema,
  })
  .strict()
const markReadSchema = z.object({ read: z.literal(true) }).strict()
const createTicketSchema = z
  .object({
    subject: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(5000),
    category: z.string().trim().min(1).max(60).default("general"),
  })
  .strict()

const iso = (value: Date | string): string => new Date(value).toISOString()
const isoOrNull = (value: Date | null): string | null => (value === null ? null : iso(value))

// --- mappers ---

const mapNotification = (row: NotificationRow): Record<string, unknown> => ({
  id: row.id,
  kind: row.kind,
  title: row.title,
  body: row.body,
  // The app models this as a boolean; the timestamp is kept for ordering/audit.
  read: row.readAt !== null,
  readAt: isoOrNull(row.readAt),
  payload: row.payload ?? {},
  createdAt: iso(row.createdAt),
})

const mapPayment = (row: ClientPaymentRow): Record<string, unknown> => ({
  id: row.id,
  orderId: row.orderId,
  fundId: row.fundId,
  status: projectPaymentStatus(row.state, row.orderState),
  amountPaise: row.amountPaise,
  currency: row.currency,
  provider: row.provider,
  failureCode: row.failureCode,
  succeededAt: isoOrNull(row.succeededAt),
  confirmedAt: isoOrNull(row.acceptedAt),
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
})

const mapTicket = (row: SupportRequestRow): Record<string, unknown> => ({
  id: row.id,
  reference: row.reference,
  category: row.category,
  subject: row.subject,
  body: row.body,
  status: row.state,
  resolutionNote: row.resolutionNote,
  resolvedAt: isoOrNull(row.resolvedAt),
  createdAt: iso(row.createdAt),
  updatedAt: iso(row.updatedAt),
})

/** FAQ items are authored as title/body; the app renders them as question/answer. */
const mapFaq = (row: ContentDocumentRow): Record<string, unknown> => ({
  key: row.contentKey,
  q: row.title,
  a: row.body,
  version: row.version,
})

// --- handlers ---

/**
 * The app tells the backend which build it is running, once per launch.
 *
 * Authenticated on purpose: the anonymous update feed (GET /v1/app/update) stays
 * anonymous so a build too old to log in can still learn it must update, and
 * everything that writes a row against a specific user lives behind a session
 * instead. The response mirrors the decision so the caller can act on it without
 * a second round trip.
 */
const reportAppVersion = async (
  deps: ClientAccountDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> => {
  const principal = await resolveClientPrincipal(request, deps)
  const body = parseOrThrow(appVersionSchema, request.body)

  const latest =
    deps.appUpdate === undefined
      ? null
      : await latestPublishedBuild(deps.appUpdate, {
          variant: body.variant,
          applicationId: body.applicationId,
        })

  const result = await deps.unitOfWork.execute((tx) =>
    reconcileAppVersion(
      tx,
      { notificationRepository: deps.notificationRepository, clock: deps.clock },
      { userId: principal.userId, versionCode: body.versionCode, latest },
    ),
  )

  return reply.sendData({
    updateAvailable: result.updateAvailable,
    notified: result.notified,
    retired: result.retired,
    latest,
  })
}

const listNotifications = async (
  deps: ClientAccountDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> => {
  const principal = await resolveClientPrincipal(request, deps)
  const query = parseOrThrow(listQuerySchema, request.query ?? {})
  const now = deps.clock()
  const filterHash = computeFilterHash({ userId: principal.userId })
  const keyset = readKeyset(deps.config.cursorKey, query.after, NOTIFICATIONS_ROUTE, filterHash, now)

  const { rows, unreadCount } = await deps.unitOfWork.execute(async (tx) => ({
    rows: await deps.clientAccountRepository.listNotifications(tx, {
      userId: principal.userId,
      ...keyset,
      limit: query.limit + 1,
    }),
    unreadCount: await deps.clientAccountRepository.countUnreadNotifications(tx, principal.userId),
  }))
  const { items, page } = paginate(
    deps.config.cursorKey,
    rows,
    query.limit,
    NOTIFICATIONS_ROUTE,
    filterHash,
    now,
    (row) => [iso(row.createdAt), row.id],
  )
  return reply.sendData(
    { items: items.map(mapNotification), unreadCount },
    { status: 200, page },
  )
}

const markNotificationRead = async (
  deps: ClientAccountDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> => {
  const principal = await resolveClientPrincipal(request, deps)
  const notificationId = parseOrThrow(uuidParam, (request.params as { notificationId?: string }).notificationId)
  parseOrThrow(markReadSchema, request.body ?? {})

  const row = await deps.unitOfWork.execute((tx) =>
    deps.clientAccountRepository.markNotificationRead(tx, {
      userId: principal.userId,
      notificationId,
      now: deps.clock(),
    }),
  )
  // Another account's notification is indistinguishable from a missing one.
  if (row === null) throw new AppError("RESOURCE_NOT_FOUND")
  return reply.sendData(mapNotification(row))
}

const listPayments = async (
  deps: ClientAccountDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> => {
  const principal = await resolveClientPrincipal(request, deps)
  const query = parseOrThrow(paymentsQuerySchema, request.query ?? {})
  const states = parsePaymentStates(query.status)
  const successProjection = paymentSuccessProjectionFor(query.status)
  const now = deps.clock()
  /*
   * The state filter is part of the cursor's identity: a cursor minted while
   * looking at failed payments cannot be replayed against the confirmed tab.
   */
  const filterHash = computeFilterHash({
    userId: principal.userId,
    states: [...states].sort().join(","),
    successProjection,
  })
  const keyset = readKeyset(deps.config.cursorKey, query.after, PAYMENTS_ROUTE, filterHash, now)

  const rows = await deps.unitOfWork.execute((tx) =>
    deps.clientAccountRepository.listPayments(tx, {
      userId: principal.userId,
      states,
      successProjection,
      ...keyset,
      limit: query.limit + 1,
    }),
  )
  const { items, page } = paginate(
    deps.config.cursorKey,
    rows,
    query.limit,
    PAYMENTS_ROUTE,
    filterHash,
    now,
    (row) => [iso(row.createdAt), row.id],
  )
  return reply.sendData({ items: items.map(mapPayment) }, { status: 200, page })
}

const listStatements = async (
  deps: ClientAccountDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> => {
  const principal = await resolveClientPrincipal(request, deps)
  const entries = await deps.unitOfWork.execute((tx) =>
    deps.clientValueEntryRepository.listByUser(tx, principal.userId),
  )
  const periods = deriveStatements(toLedgerEntries(entries))

  return reply.sendData({
    items: periods
      // Newest first for display; the derivation works oldest-first.
      .slice()
      .reverse()
      .map((period) => ({
        id: period.period,
        period: period.period,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        openingValuePaise: period.openingValuePaise.toString(),
        contributionsPaise: period.contributionsPaise.toString(),
        growthPaise: period.growthPaise.toString(),
        reversalsPaise: period.reversalsPaise.toString(),
        closingValuePaise: period.closingValuePaise.toString(),
        totalInvestmentPaise: period.totalInvestmentPaise.toString(),
        entryCount: period.entryCount,
      })),
  })
}

const listFaqs = async (
  deps: ClientAccountDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> => {
  await resolveClientPrincipal(request, deps)
  const rows = await deps.unitOfWork.execute((tx) =>
    deps.clientAccountRepository.listFaqs(tx, { limit: MAX_ITEMS }),
  )
  return reply.sendData({ items: rows.map(mapFaq) })
}

const listTickets = async (
  deps: ClientAccountDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> => {
  const principal = await resolveClientPrincipal(request, deps)
  const query = parseOrThrow(listQuerySchema, request.query ?? {})
  const now = deps.clock()
  const filterHash = computeFilterHash({ userId: principal.userId })
  const keyset = readKeyset(deps.config.cursorKey, query.after, TICKETS_ROUTE, filterHash, now)

  const rows = await deps.unitOfWork.execute((tx) =>
    deps.clientAccountRepository.listSupportRequests(tx, {
      userId: principal.userId,
      ...keyset,
      limit: query.limit + 1,
    }),
  )
  const { items, page } = paginate(
    deps.config.cursorKey,
    rows,
    query.limit,
    TICKETS_ROUTE,
    filterHash,
    now,
    (row) => [iso(row.createdAt), row.id],
  )
  return reply.sendData({ items: items.map(mapTicket) }, { status: 200, page })
}

/** Short, quotable handle: `BOE-` plus 8 hex characters of a fresh UUID. */
const nextReference = (): string => `BOE-${randomUUID().replace(/-/gu, "").slice(0, 8).toUpperCase()}`

const createTicket = async (
  deps: ClientAccountDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> => {
  const principal = await resolveClientPrincipal(request, deps)
  const body = parseOrThrow(createTicketSchema, request.body ?? {})

  const row = await deps.unitOfWork.execute(async (tx) => {
    const created = await deps.clientAccountRepository.createSupportRequest(tx, {
      userId: principal.userId,
      reference: nextReference(),
      category: body.category,
      subject: body.subject,
      body: body.body,
    })
    await deps.auditRepository.append(tx, {
      actorType: "user",
      actorUserId: principal.userId,
      command: "support.request_created",
      entityType: "support_request",
      entityId: created.id,
      toState: created.state,
      requestId: request.requestId,
      entityVersion: 1,
      // The subject is investor-authored free text; only the handle is recorded.
      metadata: { reference: created.reference, category: created.category },
    })
    return created
  })

  return reply.sendData(mapTicket(row), { status: 201 })
}

const researchContext = async (
  deps: ClientAccountDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> => {
  await resolveClientPrincipal(request, deps)
  const document = await deps.unitOfWork.execute((tx) =>
    deps.clientAccountRepository.findDocument(tx, RESEARCH_CONTENT_KEY),
  )
  // Nothing published yet is an empty list, not an error: the screen renders
  // whatever context exists and the app keeps its bundled default otherwise.
  if (document === null) return reply.sendData({ items: [] })
  const payload = document.payload
  const items =
    typeof payload === "object" && payload !== null && Array.isArray((payload as { items?: unknown }).items)
      ? (payload as { items: unknown[] }).items
      : []
  return reply.sendData({
    items,
    title: document.title,
    version: document.version,
    publishedAt: isoOrNull(document.publishedAt),
  })
}

export const registerClientAccountRoutes = (
  application: FastifyInstance,
  deps: ClientAccountDeps,
): void => {
  application.post(APP_VERSION_ROUTE, async (request, reply) => reportAppVersion(deps, request, reply))
  application.get(NOTIFICATIONS_ROUTE, async (request, reply) => listNotifications(deps, request, reply))
  application.patch(`${NOTIFICATIONS_ROUTE}/:notificationId`, async (request, reply) =>
    markNotificationRead(deps, request, reply),
  )
  application.get(PAYMENTS_ROUTE, async (request, reply) => listPayments(deps, request, reply))
  application.get(STATEMENTS_ROUTE, async (request, reply) => listStatements(deps, request, reply))
  application.get(FAQS_ROUTE, async (request, reply) => listFaqs(deps, request, reply))
  application.get(TICKETS_ROUTE, async (request, reply) => listTickets(deps, request, reply))
  application.post(TICKETS_ROUTE, async (request, reply) => createTicket(deps, request, reply))
  application.get(RESEARCH_ROUTE, async (request, reply) => researchContext(deps, request, reply))
}
