import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { Kysely } from "kysely"
import { z } from "zod"

import type { Transaction } from "../db/repositories.js"
import type { Database } from "../db/types.js"
import { requireAnyPermission, resolveAdminPrincipal } from "../domain/admin/adminAccess.js"
import { MAX_GROWTH_BASIS_POINTS, MIN_GROWTH_BASIS_POINTS } from "../domain/admin/clientGrowth.js"
import {
  computeInvestmentGrowthBasisHash,
  planInvestmentGrowth,
  type InvestmentGrowthInstruction,
  type InvestmentGrowthPlan,
  type PlannedInvestmentEntry,
} from "../domain/admin/investmentGrowth.js"
import type { WebAuthDeps } from "../domain/auth/webAuth.js"
import type { InvestmentRef } from "../domain/client/investmentBreakdownFacts.js"
import { queueInvestmentGrowthMail, type InvestmentGrowthMailDeps } from "../domain/email/investmentGrowthMail.js"
import { refuseFutureDate } from "../domain/shared/calendarDate.js"
import { refuseErasedClient } from "../domain/shared/erasedClient.js"
import { CLIENT_GROWTH_AUDIT_METADATA } from "../domain/shared/growthAuditMetadata.js"
import { AppError } from "../http/errorCatalog.js"
import { parseOrThrow } from "../http/validation.js"
import type { AuditWriteRepository } from "../repositories/auditRepository.js"
import type { ClientGrowthRepository } from "../repositories/clientGrowthRepository.js"
import type { InvestmentBreakdownRepository } from "../repositories/investmentBreakdownRepository.js"
import type { NotificationWriteRepository } from "../repositories/notificationRepository.js"
import { nonZeroSignedPaiseSchema, reasonCodeSchema, reasonDetailSchema, uuidParam } from "./adminRouteKit.js"
import { runGrowthCommit, valueUpdatedNotice, type GrowthCommitDeps } from "./adminClientGrowthRoutes.js"
import { loadFundGrowthBases, mailEntryOf, partBody, planBody, type LoadedFundGrowthBases } from "./investmentGrowthProjection.js"

export interface AdminInvestmentGrowthDeps extends InvestmentGrowthMailDeps, GrowthCommitDeps {
  readonly webAuth: WebAuthDeps
  readonly database: Kysely<Database>
  readonly config: Readonly<{ idempotencyTtlMs: number; sesConfigurationSet: string }>
  readonly clientGrowthRepository: ClientGrowthRepository
  readonly investmentBreakdownRepository: Pick<InvestmentBreakdownRepository, "loadBreakdownContexts">
  readonly auditRepository: AuditWriteRepository
  readonly notificationRepository: NotificationWriteRepository
}

const INDIVIDUAL_ROUTE = "/v1/admin/investment-growth/individual"
const PREVIEW_ROUTE = "/v1/admin/investment-growth/preview"
const COMMIT_ROUTE = "/v1/admin/investment-growth/commit"
const COMMAND_INDIVIDUAL = "investment-growth.individual"
const COMMAND_PERCENTAGE = "investment-growth.percentage"
const COMMAND_GAINS = "investment-growth.gain_since_invested"
const MAX_ITEMS = 500

const signedPaiseSchema = z.string().regex(/^(0|-?[1-9][0-9]{0,17})$/u, "must be a signed whole number of paise")
const growthBasisPointsSchema = z.coerce.number().int().min(MIN_GROWTH_BASIS_POINTS).max(MAX_GROWTH_BASIS_POINTS)
const refSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("sip"), scheduleId: uuidParam }).strict(),
  z.object({ kind: z.literal("one_time"), allocationId: uuidParam }).strict(),
])
const itemSchema = z.object({ userId: uuidParam, ref: refSchema, gainSinceInvestedPaise: signedPaiseSchema }).strict()
const writeMeta = {
  effectiveDate: z.iso.date(),
  reasonCode: reasonCodeSchema,
  note: reasonDetailSchema.optional(),
}
const collectiveFields = {
  fundId: uuidParam,
  growthBasisPoints: growthBasisPointsSchema.optional(),
  items: z.array(itemSchema).min(1).max(MAX_ITEMS).optional(),
}
const oneMode = (value: { growthBasisPoints?: number | undefined; items?: unknown[] | undefined }): boolean =>
  (value.growthBasisPoints === undefined) !== (value.items === undefined)
const oneModeMessage = { message: "Provide exactly one of growthBasisPoints or items." }

const previewSchema = z.object(collectiveFields).strict().refine(oneMode, oneModeMessage)
const commitSchema = z
  .object({ ...collectiveFields, basisHash: z.string().regex(/^[0-9a-f]{64}$/u), ...writeMeta })
  .strict()
  .refine(oneMode, oneModeMessage)
const individualSchema = z
  .object({
    userId: uuidParam,
    fundId: uuidParam,
    ref: refSchema,
    growthPaise: nonZeroSignedPaiseSchema.optional(),
    growthBasisPoints: growthBasisPointsSchema.optional(),
    ...writeMeta,
  })
  .strict()
  .refine((value) => (value.growthPaise === undefined) !== (value.growthBasisPoints === undefined), {
    message: "Provide exactly one of growthPaise or growthBasisPoints.",
  })

type CollectiveBody = z.infer<typeof previewSchema>

const collectiveInstruction = (body: CollectiveBody): InvestmentGrowthInstruction =>
  body.growthBasisPoints !== undefined
    ? { kind: "percentage", growthBasisPoints: BigInt(body.growthBasisPoints), target: null }
    : {
        kind: "gain_since_invested",
        items: (body.items ?? []).map((item) => ({
          userId: item.userId,
          ref: item.ref,
          gainSinceInvestedPaise: BigInt(item.gainSinceInvestedPaise),
        })),
      }

const modeOf = (body: CollectiveBody): "percentage" | "gain_since_invested" =>
  body.growthBasisPoints !== undefined ? "percentage" : "gain_since_invested"

const commandOf = (body: CollectiveBody): string => (body.growthBasisPoints !== undefined ? COMMAND_PERCENTAGE : COMMAND_GAINS)

const resolveWriter = async (deps: AdminInvestmentGrowthDeps, request: FastifyRequest) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, ["client_growth.write"])
  return principal
}

const sendResult = (reply: FastifyReply, result: { status: number; body: Record<string, unknown>; replay: boolean }) =>
  reply.sendData(result.body, { status: result.status, ...(result.replay ? { idempotencyReplay: true } : {}) })

interface WriteContext {
  readonly principalUserId: string
  readonly requestId: string
  readonly fundId: string
  readonly effectiveDate: string
  readonly reasonCode: string
  readonly note: string | null
}

const writeEntries = async (
  deps: AdminInvestmentGrowthDeps,
  tx: Transaction,
  context: WriteContext,
  batchId: string,
  entries: readonly PlannedInvestmentEntry[],
): Promise<readonly string[]> => {
  const entryIds: string[] = []
  for (const entry of entries) {
    const written = await deps.clientGrowthRepository.insertGrowthEntry(tx, {
      batchId,
      userId: entry.userId,
      fundId: context.fundId,
      valueDeltaPaise: entry.deltaPaise,
      effectiveDate: context.effectiveDate,
      reasonCode: context.reasonCode,
      note: context.note,
      actorUserId: context.principalUserId,
      requestId: context.requestId,
    })
    await deps.clientGrowthRepository.insertGrowthParts(tx, {
      entryId: written.id,
      userId: entry.userId,
      fundId: context.fundId,
      parts: entry.parts,
    })
    await deps.notificationRepository.create(tx, valueUpdatedNotice(entry.userId, context.fundId, written.id))
    entryIds.push(written.id)
  }
  return entryIds
}

const recordBatch = async (
  deps: AdminInvestmentGrowthDeps,
  tx: Transaction,
  context: WriteContext,
  input: Readonly<{ scope: "individual" | "collective"; instructionType: "amount" | "percentage" | "explicit_deltas"; basisHash: string }>,
  plan: InvestmentGrowthPlan,
  loaded: LoadedFundGrowthBases,
): Promise<Readonly<{ batchId: string; entryIds: readonly string[] }>> => {
  const batch = await deps.clientGrowthRepository.insertBatch(tx, {
    scope: input.scope,
    instructionType: input.instructionType,
    effectiveDate: context.effectiveDate,
    reasonCode: context.reasonCode,
    note: context.note,
    basisHash: input.basisHash,
    actorUserId: context.principalUserId,
    requestId: context.requestId,
    targetCount: plan.entries.length,
    totalDeltaPaise: plan.totalDeltaPaise,
  })
  const entryIds = await writeEntries(deps, tx, context, batch.id, plan.entries)
  await queueInvestmentGrowthMail(tx, deps, {
    batchId: batch.id,
    fundId: context.fundId,
    effectiveDate: context.effectiveDate,
    requestId: context.requestId,
    entries: plan.entries.map((entry) => mailEntryOf(loaded, entry)),
  })
  await deps.auditRepository.append(tx, {
    actorType: "admin",
    actorUserId: context.principalUserId,
    command: `client_growth.${input.scope}`,
    entityType: "client_growth_batch",
    entityId: batch.id,
    requestId: context.requestId,
    entityVersion: 1,
    metadata: {
      fundId: context.fundId,
      scope: input.scope,
      instructionType: input.instructionType,
      targeting: "investment",
      effectiveDate: context.effectiveDate,
      reasonCode: context.reasonCode,
      targetCount: plan.entries.length,
      partCount: plan.entries.reduce((sum, entry) => sum + entry.parts.length, 0),
      skippedCount: plan.skipped.length,
      totalDeltaPaise: plan.totalDeltaPaise.toString(),
      ...CLIENT_GROWTH_AUDIT_METADATA,
    },
  })
  return { batchId: batch.id, entryIds }
}

const individual = async (deps: AdminInvestmentGrowthDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveWriter(deps, request)
  const body = parseOrThrow(individualSchema, request.body)
  refuseFutureDate("effectiveDate", body.effectiveDate, deps.clock())
  const target = { userId: body.userId, ref: body.ref as InvestmentRef }
  const instruction: InvestmentGrowthInstruction =
    body.growthPaise !== undefined
      ? { kind: "amount", growthPaise: BigInt(body.growthPaise), target }
      : { kind: "percentage", growthBasisPoints: BigInt(body.growthBasisPoints ?? 0), target }
  const context: WriteContext = {
    principalUserId: principal.userId,
    requestId: request.requestId,
    fundId: body.fundId,
    effectiveDate: body.effectiveDate,
    reasonCode: body.reasonCode,
    note: body.note ?? null,
  }
  const result = await runGrowthCommit(deps, request, INDIVIDUAL_ROUTE, { ...body }, principal.userId, async (tx) => {
    await deps.clientGrowthRepository.lockPosition(tx, body.userId, body.fundId)
    refuseErasedClient(await deps.clientGrowthRepository.findErasedAt(tx, body.userId))
    const loaded = await loadFundGrowthBases(deps, tx, body.fundId, body.userId)
    const clientBases = loaded.perUser.get(body.userId)
    if (clientBases === undefined) throw new AppError("RESOURCE_NOT_FOUND")
    const plan = planInvestmentGrowth(loaded.bases, instruction)
    const [entry] = plan.entries
    const [part] = entry?.parts ?? []
    if (entry === undefined || part === undefined) throw new AppError("INTERNAL_ERROR")
    const basisHash = computeInvestmentGrowthBasisHash(COMMAND_INDIVIDUAL, body.fundId, loaded.bases)
    const written = await recordBatch(deps, tx, context, { scope: "individual", instructionType: instruction.kind === "amount" ? "amount" : "percentage", basisHash }, plan, loaded)
    return {
      status: 201,
      batchId: written.batchId,
      body: {
        batchId: written.batchId,
        entryId: written.entryIds[0] ?? "",
        userId: body.userId,
        fundId: body.fundId,
        effectiveDate: body.effectiveDate,
        reasonCode: body.reasonCode,
        principalPaise: clientBases.positionInvestedPaise.toString(),
        beforePaise: entry.beforePaise.toString(),
        currentValuePaise: entry.beforePaise.toString(),
        deltaPaise: entry.deltaPaise.toString(),
        growthPaise: entry.deltaPaise.toString(),
        afterPaise: entry.afterPaise.toString(),
        newValuePaise: entry.afterPaise.toString(),
        part: partBody(loaded, body.userId, part),
      },
    }
  })
  return sendResult(reply, result)
}

const preview = async (deps: AdminInvestmentGrowthDeps, request: FastifyRequest, reply: FastifyReply) => {
  await resolveWriter(deps, request)
  const body = parseOrThrow(previewSchema, request.body)
  const loaded = await loadFundGrowthBases(deps, deps.database, body.fundId)
  const plan = planInvestmentGrowth(loaded.bases, collectiveInstruction(body))
  return reply.sendData(
    {
      fundId: body.fundId,
      mode: modeOf(body),
      basisHash: computeInvestmentGrowthBasisHash(commandOf(body), body.fundId, loaded.bases),
      ...planBody(loaded, plan),
    },
    { status: 200 },
  )
}

const refuseUnwritable = (body: CollectiveBody, plan: InvestmentGrowthPlan): void => {
  if (body.items !== undefined && plan.skipped.some((skip) => skip.reason === "categorise_first")) {
    throw new AppError("STATE_CONFLICT", {
      message: "Some of these clients must have their recordings categorised first. Leave their rows out and try again.",
    })
  }
  if (plan.entries.length === 0) {
    throw new AppError("STATE_CONFLICT", { message: "Nothing to record: no investment in this update changes value." })
  }
}

const commit = async (deps: AdminInvestmentGrowthDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveWriter(deps, request)
  const body = parseOrThrow(commitSchema, request.body)
  refuseFutureDate("effectiveDate", body.effectiveDate, deps.clock())
  const context: WriteContext = {
    principalUserId: principal.userId,
    requestId: request.requestId,
    fundId: body.fundId,
    effectiveDate: body.effectiveDate,
    reasonCode: body.reasonCode,
    note: body.note ?? null,
  }
  const result = await runGrowthCommit(deps, request, COMMIT_ROUTE, { ...body }, principal.userId, async (tx) => {
    const initial = await deps.clientGrowthRepository.listFundPositionBases(tx, body.fundId)
    for (const row of initial) await deps.clientGrowthRepository.lockPosition(tx, row.userId, body.fundId)
    const loaded = await loadFundGrowthBases(deps, tx, body.fundId)
    if (computeInvestmentGrowthBasisHash(commandOf(body), body.fundId, loaded.bases) !== body.basisHash) {
      throw new AppError("STATE_CONFLICT", {
        message: "The client value basis changed after the preview; run the preview again.",
      })
    }
    const plan = planInvestmentGrowth(loaded.bases, collectiveInstruction(body))
    refuseUnwritable(body, plan)
    const instructionType = body.growthBasisPoints !== undefined ? "percentage" : "explicit_deltas"
    const written = await recordBatch(deps, tx, context, { scope: "collective", instructionType, basisHash: body.basisHash }, plan, loaded)
    return {
      status: 201,
      batchId: written.batchId,
      body: {
        batchId: written.batchId,
        fundId: body.fundId,
        mode: modeOf(body),
        effectiveDate: body.effectiveDate,
        ...planBody(loaded, plan),
      },
    }
  })
  return sendResult(reply, result)
}

export const registerAdminInvestmentGrowthRoutes = (application: FastifyInstance, deps: AdminInvestmentGrowthDeps): void => {
  application.post(INDIVIDUAL_ROUTE, (request, reply) => individual(deps, request, reply))
  application.post(PREVIEW_ROUTE, (request, reply) => preview(deps, request, reply))
  application.post(COMMIT_ROUTE, (request, reply) => commit(deps, request, reply))
}
