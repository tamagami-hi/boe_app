import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { Kysely } from "kysely"
import { z } from "zod"

import type { UnitOfWork } from "../db/database.js"
import type { IdempotencyRepository } from "../db/repositories.js"
import type { Database } from "../db/types.js"
import { requireAnyPermission, resolveAdminPrincipal } from "../domain/admin/adminAccess.js"
import {
  isOneTimeAllowed,
  isSipLinkAllowed,
  linkEarlierRecordings,
  markRecordingOneTime,
  type RecordingHistoryDeps,
} from "../domain/admin/recordingHistory.js"
import { proposeSipLinks, scheduleMonthsOf } from "../domain/admin/sipLinkProposal.js"
import { MAX_SCHEDULE_MONTHS } from "../domain/admin/sipScheduleMonths.js"
import type { WebAuthDeps } from "../domain/auth/webAuth.js"
import { assignedCategoryOf, recordingLabelOf } from "../domain/shared/recordingCategory.js"
import { AppError } from "../http/errorCatalog.js"
import { parseOrThrow } from "../http/validation.js"
import type { RecordingRow } from "../repositories/recordingCategoryRepository.js"
import { POSITION_READ_PERMISSIONS, POSITION_WRITE_PERMISSIONS } from "./adminClientPositionRoutes.js"
import {
  adminIdempotencyScope,
  hashRequest,
  iso,
  requireIdempotencyKey,
  runAdminMutation,
  uuidParam,
} from "./adminRouteKit.js"
import { mapAdminSipSchedule, sipMonthSchema } from "./sipScheduleProjection.js"

const RECORDINGS_ROUTE = "/v1/admin/clients/:userId/recorded-contributions"
const CATEGORY_ROUTE = "/v1/admin/clients/:userId/recorded-contributions/:entryId/category"
const PROPOSAL_ROUTE = "/v1/admin/clients/:userId/sip-schedules/:scheduleId/link-proposal"
const MONTH_LINKS_ROUTE = "/v1/admin/clients/:userId/sip-schedules/:scheduleId/month-links"

export interface AdminRecordingCategoryDeps extends RecordingHistoryDeps {
  readonly webAuth: WebAuthDeps
  readonly unitOfWork: UnitOfWork
  readonly database: Kysely<Database>
  readonly idempotencyRepository: IdempotencyRepository
  readonly clock: () => Date
  readonly config: Readonly<{ idempotencyTtlMs: number }>
}

const recordingsQuerySchema = z.object({ fundId: uuidParam.optional() }).strict()
const categoryBodySchema = z.object({ category: z.enum(["one_time"]) }).strict()
const monthLinksBodySchema = z
  .object({
    links: z
      .array(z.object({ month: sipMonthSchema, entryId: uuidParam }).strict())
      .min(1)
      .max(MAX_SCHEDULE_MONTHS),
  })
  .strict()

const paramOf = (request: FastifyRequest, name: "userId" | "entryId" | "scheduleId"): string =>
  parseOrThrow(uuidParam, (request.params as Record<string, unknown>)[name])

export const mapRecording = (row: RecordingRow): Record<string, unknown> => {
  const category = assignedCategoryOf({ linked: row.linkMonth !== null, oneTime: row.oneTime })
  return {
    entryId: row.entryId,
    fundId: row.fundId,
    amountPaise: row.amountPaise,
    effectiveDate: row.effectiveDate,
    reasonCode: row.reasonCode,
    recordedAt: iso(row.recordedAt),
    reversed: row.reversed,
    category,
    categoryLabel: recordingLabelOf(row.reasonCode, category),
    sipScheduleId: row.linkScheduleId,
    sipMonth: row.linkMonth,
    sipLinkAllowed: isSipLinkAllowed(row),
    oneTimeAllowed: isOneTimeAllowed(row),
  }
}

const listRecordings = async (deps: AdminRecordingCategoryDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, [...POSITION_READ_PERMISSIONS])
  const userId = paramOf(request, "userId")
  const query = parseOrThrow(recordingsQuerySchema, request.query)
  const rows = await deps.recordingCategoryRepository.listRecordings(deps.database, {
    userId,
    fundId: query.fundId ?? null,
  })
  return reply.sendData({ items: rows.map(mapRecording) }, { status: 200 })
}

const linkProposal = async (deps: AdminRecordingCategoryDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, [...POSITION_READ_PERMISSIONS])
  const userId = paramOf(request, "userId")
  const scheduleId = paramOf(request, "scheduleId")
  const schedule = await deps.sipScheduleRepository.findForUser(deps.database, { userId, scheduleId })
  if (schedule === null) throw new AppError("RESOURCE_NOT_FOUND")
  const recordings = await deps.recordingCategoryRepository.listRecordings(deps.database, {
    userId,
    fundId: schedule.fundId,
  })
  const candidates = recordings.filter(isSipLinkAllowed)
  const proposal = proposeSipLinks(
    { startMonth: schedule.startMonth, monthCount: schedule.monthCount, filledMonths: schedule.paidMonths },
    candidates,
  )
  const linkedEntry = new Map(
    recordings
      .filter((row) => row.linkScheduleId === scheduleId && row.linkMonth !== null)
      .map((row) => [row.linkMonth, row.entryId] as const),
  )
  const paid = new Set(schedule.paidMonths)
  const months = scheduleMonthsOf(schedule.startMonth, schedule.monthCount).map((month, index) => ({
    month,
    monthNumber: index + 1,
    paid: paid.has(month),
    linkedEntryId: linkedEntry.get(month) ?? null,
    proposedEntryId: proposal.get(month) ?? null,
  }))
  return reply.sendData(
    { scheduleId, months, candidates: candidates.map(mapRecording), schedule: mapAdminSipSchedule(schedule, deps.clock()) },
    { status: 200 },
  )
}

const linkMonths = async (deps: AdminRecordingCategoryDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, [...POSITION_WRITE_PERMISSIONS])
  const userId = paramOf(request, "userId")
  const scheduleId = paramOf(request, "scheduleId")
  const body = parseOrThrow(monthLinksBodySchema, request.body)
  const key = requireIdempotencyKey(request)
  const now = deps.clock()

  const result = await runAdminMutation({
    unitOfWork: deps.unitOfWork,
    idempotencyRepository: deps.idempotencyRepository,
    now,
    idempotencyTtlMs: deps.config.idempotencyTtlMs,
    retention: "durable",
    scope: adminIdempotencyScope(principal.userId, MONTH_LINKS_ROUTE, key),
    requestHash: hashRequest({ userId, scheduleId, links: body.links }),
    execute: async (tx) => {
      const schedule = await linkEarlierRecordings(tx, deps, {
        userId,
        scheduleId,
        links: body.links,
        actorUserId: principal.userId,
        requestId: request.requestId,
      })
      return { status: 201, body: { linked: body.links.length, schedule: mapAdminSipSchedule(schedule, now) } }
    },
  })
  return reply.sendData(result.body, { status: result.status, ...(result.replay ? { idempotencyReplay: true } : {}) })
}

const setCategory = async (deps: AdminRecordingCategoryDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, [...POSITION_WRITE_PERMISSIONS])
  const userId = paramOf(request, "userId")
  const entryId = paramOf(request, "entryId")
  const body = parseOrThrow(categoryBodySchema, request.body)
  const key = requireIdempotencyKey(request)

  const result = await runAdminMutation({
    unitOfWork: deps.unitOfWork,
    idempotencyRepository: deps.idempotencyRepository,
    now: deps.clock(),
    idempotencyTtlMs: deps.config.idempotencyTtlMs,
    retention: "durable",
    scope: adminIdempotencyScope(principal.userId, CATEGORY_ROUTE, key),
    requestHash: hashRequest({ userId, entryId, category: body.category }),
    execute: async (tx) => {
      const recording = await markRecordingOneTime(tx, deps, {
        userId,
        entryId,
        actorUserId: principal.userId,
        requestId: request.requestId,
      })
      return { status: 201, body: { recording: mapRecording(recording) } }
    },
  })
  return reply.sendData(result.body, { status: result.status, ...(result.replay ? { idempotencyReplay: true } : {}) })
}

export const registerAdminRecordingCategoryRoutes = (
  application: FastifyInstance,
  deps: AdminRecordingCategoryDeps,
): void => {
  application.get(RECORDINGS_ROUTE, (request, reply) => listRecordings(deps, request, reply))
  application.get(PROPOSAL_ROUTE, (request, reply) => linkProposal(deps, request, reply))
  application.post(MONTH_LINKS_ROUTE, (request, reply) => linkMonths(deps, request, reply))
  application.post(CATEGORY_ROUTE, (request, reply) => setCategory(deps, request, reply))
}
