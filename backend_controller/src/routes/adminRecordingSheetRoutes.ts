import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { Kysely } from "kysely"
import { z } from "zod"

import type { Database } from "../db/types.js"
import { requireAnyPermission, resolveAdminPrincipal } from "../domain/admin/adminAccess.js"
import type { WebAuthDeps } from "../domain/auth/webAuth.js"
import { AppError } from "../http/errorCatalog.js"
import { paginate, readKeysetValues } from "../http/pagination.js"
import { parseOrThrow } from "../http/validation.js"
import type { MonthlyRecordingSheetRepository, RecordingSheetRow } from "../repositories/monthlyRecordingSheetRepository.js"
import { POSITION_READ_PERMISSIONS } from "./adminClientPositionRoutes.js"
import { computeFilterHash, iso, limitSchema, uuidParam } from "./adminRouteKit.js"
import { sipMonthSchema } from "./sipScheduleProjection.js"

const RECORDING_SHEET_ROUTE = "/v1/admin/recording-sheet"

export interface AdminRecordingSheetDeps {
  readonly webAuth: WebAuthDeps
  readonly database: Kysely<Database>
  readonly clock: () => Date
  readonly config: { readonly cursorKey: Buffer }
  readonly recordingSheetRepository: MonthlyRecordingSheetRepository
}

const querySchema = z
  .object({
    month: sipMonthSchema,
    fundId: uuidParam.optional(),
    after: z.string().min(1).optional(),
    limit: limitSchema,
  })
  .strict()

const afterScheduleIdOf = (values: readonly string[]): string | null => {
  if (values.length === 0) return null
  const parsed = uuidParam.safeParse(values[0])
  if (values.length !== 1 || !parsed.success) throw new AppError("CURSOR_INVALID")
  return parsed.data
}

const recordedOf = (row: RecordingSheetRow) =>
  row.entryId === null || row.recordedAmountPaise === null || row.recordedEffectiveDate === null || row.recordedAt === null
    ? null
    : {
        entryId: row.entryId,
        amountPaise: row.recordedAmountPaise,
        effectiveDate: row.recordedEffectiveDate,
        recordedAt: iso(row.recordedAt),
      }

const rowBody = (row: RecordingSheetRow) => ({
  scheduleId: row.scheduleId,
  userId: row.userId,
  clientName: row.clientName,
  clientEmail: row.clientEmail,
  fundId: row.fundId,
  fundName: row.fundName,
  monthlyAmountPaise: row.monthlyAmountPaise,
  startMonth: row.startMonth,
  monthCount: row.monthCount,
  recorded: recordedOf(row),
})

const listRecordingSheet = async (deps: AdminRecordingSheetDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, [...POSITION_READ_PERMISSIONS])
  const query = parseOrThrow(querySchema, request.query)
  const now = deps.clock()
  const filterHash = computeFilterHash({ month: query.month, fundId: query.fundId ?? null })
  const afterScheduleId = afterScheduleIdOf(
    readKeysetValues(deps.config.cursorKey, query.after, RECORDING_SHEET_ROUTE, filterHash, now),
  )
  const rows = await deps.recordingSheetRepository.listDueSchedules(deps.database, {
    monthStart: `${query.month}-01`,
    fundId: query.fundId ?? null,
    afterScheduleId,
    limit: query.limit + 1,
  })
  const { items, page } = paginate(deps.config.cursorKey, rows, query.limit, RECORDING_SHEET_ROUTE, filterHash, now, (row) => [
    row.scheduleId,
  ])
  return reply.sendData({ month: query.month, items: items.map(rowBody) }, { status: 200, page })
}

export const registerAdminRecordingSheetRoutes = (application: FastifyInstance, deps: AdminRecordingSheetDeps): void => {
  application.get(RECORDING_SHEET_ROUTE, (request, reply) => listRecordingSheet(deps, request, reply))
}
