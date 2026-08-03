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
 * Statements are derived per read from the investor ledger rather than stored, for
 * the same reason the dashboard is: one source of truth means a statement can
 * never disagree with the live figures.
 */
import { randomUUID } from "node:crypto"

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { Kysely } from "kysely"
import { z } from "zod"

import type { UnitOfWork } from "../db/database.js"
import type { Database, PaymentState } from "../db/types.js"
import { authenticateNativeRequest, type NativeRequestAuthDeps } from "../domain/auth/nativeAuth.js"
import { toLedgerEntries } from "../domain/client/portfolioProjection.js"
import { deriveStatements } from "../domain/client/statements.js"
import { AppError } from "../http/errorCatalog.js"
import { parseOrThrow } from "../http/validation.js"
import type { AuditWriteRepository } from "../repositories/auditRepository.js"
import type {
  ClientAccountRepository,
  ClientPaymentRow,
  ContentDocumentRow,
  NotificationRow,
  SupportRequestRow,
} from "../repositories/clientAccountRepository.js"
import type { InvestorLedgerRepository } from "../repositories/investorLedgerRepository.js"

export interface ClientAccountDeps extends NativeRequestAuthDeps {
  readonly clientAccountRepository: ClientAccountRepository
  readonly investorLedgerRepository: InvestorLedgerRepository
  readonly auditRepository: AuditWriteRepository
  readonly unitOfWork: UnitOfWork
  readonly database: Kysely<Database>
  readonly clock: () => Date
}

const NOTIFICATIONS_ROUTE = "/v1/client/notifications"
const PAYMENTS_ROUTE = "/v1/client/payments"
const STATEMENTS_ROUTE = "/v1/client/statements"
const FAQS_ROUTE = "/v1/client/support/faqs"
const TICKETS_ROUTE = "/v1/client/support/tickets"
const RESEARCH_ROUTE = "/v1/client/research-context"

/** Content keys the app reads; published rows only. */
const RESEARCH_CONTENT_KEY = "research-context"

const MAX_ITEMS = 200
const DEFAULT_ITEMS = 50

const limitSchema = z.coerce.number().int().min(1).max(MAX_ITEMS).default(DEFAULT_ITEMS)
const listQuerySchema = z.object({ limit: limitSchema }).strict()
const uuidParam = z.string().uuid()

const PAYMENT_STATES = [
  "created",
  "provider_pending",
  "succeeded",
  "failed",
  "expired",
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
}

const parsePaymentStates = (raw: string | undefined): readonly PaymentState[] => {
  if (raw === undefined || raw.trim() === "") return []
  const requested = raw
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part !== "")
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

const paymentsQuerySchema = z.object({ status: z.string().optional(), limit: limitSchema }).strict()
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
  status: row.state,
  amountPaise: row.amountPaise,
  currency: row.currency,
  provider: row.provider,
  failureCode: row.failureCode,
  succeededAt: isoOrNull(row.succeededAt),
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

const listNotifications = async (
  deps: ClientAccountDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> => {
  const principal = await authenticateNativeRequest(request, deps)
  const { limit } = parseOrThrow(listQuerySchema, request.query ?? {})
  const rows = await deps.unitOfWork.execute((tx) =>
    deps.clientAccountRepository.listNotifications(tx, { userId: principal.userId, limit }),
  )
  return reply.sendData({
    items: rows.map(mapNotification),
    unreadCount: rows.filter((row) => row.readAt === null).length,
  })
}

const markNotificationRead = async (
  deps: ClientAccountDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> => {
  const principal = await authenticateNativeRequest(request, deps)
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
  const principal = await authenticateNativeRequest(request, deps)
  const query = parseOrThrow(paymentsQuerySchema, request.query ?? {})
  const states = parsePaymentStates(query.status)
  const rows = await deps.unitOfWork.execute((tx) =>
    deps.clientAccountRepository.listPayments(tx, { userId: principal.userId, states, limit: query.limit }),
  )
  return reply.sendData({ items: rows.map(mapPayment) })
}

const listStatements = async (
  deps: ClientAccountDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> => {
  const principal = await authenticateNativeRequest(request, deps)
  const entries = await deps.unitOfWork.execute((tx) =>
    deps.investorLedgerRepository.listByUser(tx, principal.userId),
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
        returnsPaise: period.returnsPaise.toString(),
        withdrawalsPaise: period.withdrawalsPaise.toString(),
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
  await authenticateNativeRequest(request, deps)
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
  const principal = await authenticateNativeRequest(request, deps)
  const { limit } = parseOrThrow(listQuerySchema, request.query ?? {})
  const rows = await deps.unitOfWork.execute((tx) =>
    deps.clientAccountRepository.listSupportRequests(tx, { userId: principal.userId, limit }),
  )
  return reply.sendData({ items: rows.map(mapTicket) })
}

/** Short, quotable handle: `BOE-` plus 8 hex characters of a fresh UUID. */
const nextReference = (): string => `BOE-${randomUUID().replace(/-/gu, "").slice(0, 8).toUpperCase()}`

const createTicket = async (
  deps: ClientAccountDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> => {
  const principal = await authenticateNativeRequest(request, deps)
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
  await authenticateNativeRequest(request, deps)
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
