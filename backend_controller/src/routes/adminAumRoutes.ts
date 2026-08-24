import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { Kysely } from "kysely"
import { z } from "zod"

import type { UnitOfWork } from "../db/database.js"
import type { IdempotencyRepository, Transaction } from "../db/repositories.js"
import type { Database, FundState } from "../db/types.js"
import { requireAnyPermission, resolveAdminPrincipal } from "../domain/admin/adminAccess.js"
import {
  assertAumDeltaNonZero,
  aumGrowthDelta,
  canonicalCollectiveAumCommand,
  computeAumBasisHash,
  planAumGrowth,
  type AumFundBasis,
  type AumGrowthInstruction,
  type CollectiveAumInstruction,
} from "../domain/admin/fundAumGrowth.js"
import type { WebAuthDeps } from "../domain/auth/webAuth.js"
import { AppError } from "../http/errorCatalog.js"
import type { FixedWindowRateLimiter } from "../http/rateLimit.js"
import { parseOrThrow } from "../http/validation.js"
import type { AuditWriteRepository } from "../repositories/auditRepository.js"
import type { FundAumRepository, FundAumSnapshotRow } from "../repositories/fundAumRepository.js"
import {
  adminIdempotencyScope,
  computeFilterHash,
  hashRequest,
  iso,
  limitSchema,
  paginate,
  reasonCodeSchema,
  readKeysetValues,
  requireIdempotencyKey,
  runAdminMutation,
  uuidParam,
} from "./adminRouteKit.js"

export const AUM_ROUTE = "/v1/admin/aum"

export const MAX_COLLECTIVE_FUND_COUNT = 100
export const DEFAULT_MAX_GROWTH_BASIS_POINTS = 100_000

export interface AdminAumConfig {
  readonly cursorKey: Buffer
  readonly idempotencyTtlMs: number
  readonly maxGrowthBasisPoints?: number
}

export interface AdminAumDeps {
  readonly webAuth: WebAuthDeps
  readonly unitOfWork: UnitOfWork
  readonly database: Kysely<Database>
  readonly clock: () => Date
  readonly config: AdminAumConfig
  readonly aumRepository: FundAumRepository
  readonly auditRepository: AuditWriteRepository
  readonly idempotencyRepository: IdempotencyRepository
  readonly rateLimiter: FixedWindowRateLimiter
}

const signedPaiseSchema = z
  .string()
  .trim()
  .regex(/^-?(0|[1-9]\d{0,18})$/u, "must be a signed decimal paise string")
const nonZeroSignedPaiseSchema = signedPaiseSchema.refine(
  (value) => !/^-?0$/u.test(value),
  "must not be zero — a growth command has to change the figure",
)
const nonZeroBasisPointsSchema = (maxBasisPoints: number) =>
  z
    .number()
    .int()
    .min(-10_000)
    .max(maxBasisPoints)
    .refine((value) => value !== 0, "must not be zero — a growth command has to change the figure")
const nonNegativePaiseSchema = z
  .string()
  .trim()
  .regex(/^(0|[1-9]\d{0,18})$/u, "must be a non-negative decimal paise string")
const asOfDateSchema = z.iso.date()
const noteSchema = z.string().trim().min(1).max(2000).optional()

const initializeBodySchema = z
  .object({
    aumPaise: nonNegativePaiseSchema,
    asOfDate: asOfDateSchema,
    reasonCode: reasonCodeSchema,
    note: noteSchema,
  })
  .strict()

const growthBodySchema = (maxBasisPoints: number) =>
  z
    .object({
      growthPaise: nonZeroSignedPaiseSchema.optional(),
      growthBasisPoints: nonZeroBasisPointsSchema(maxBasisPoints).optional(),
      asOfDate: asOfDateSchema,
      reasonCode: reasonCodeSchema,
      note: noteSchema,
    })
    .strict()
    .refine(
      (body) => (body.growthPaise === undefined) !== (body.growthBasisPoints === undefined),
      { message: "Provide exactly one of growthPaise or growthBasisPoints." },
    )

const correctionBodySchema = z
  .object({
    aumPaise: nonNegativePaiseSchema,
    reasonCode: reasonCodeSchema,
    note: noteSchema,
  })
  .strict()

interface CollectiveShape {
  readonly asOfDate: string
  readonly reasonCode: string
  readonly note?: string | undefined
  readonly fundIds?: readonly string[] | undefined
  readonly growthBasisPoints?: number | undefined
  readonly items?: readonly { readonly fundId: string; readonly growthPaise: string }[] | undefined
}

const collectiveFields = (maxBasisPoints: number) => ({
  asOfDate: asOfDateSchema,
  reasonCode: reasonCodeSchema,
  note: noteSchema,
  fundIds: z.array(uuidParam).min(1).max(MAX_COLLECTIVE_FUND_COUNT).optional(),
  growthBasisPoints: nonZeroBasisPointsSchema(maxBasisPoints).optional(),
  items: z
    .array(z.object({ fundId: uuidParam, growthPaise: nonZeroSignedPaiseSchema }).strict())
    .min(1)
    .max(MAX_COLLECTIVE_FUND_COUNT)
    .optional(),
})

const withCollectiveRefinements = <S extends z.ZodType<CollectiveShape>>(schema: S): S =>
  schema
    .refine(
      (body) =>
        (body.growthBasisPoints !== undefined && body.fundIds !== undefined && body.items === undefined) ||
        (body.items !== undefined && body.growthBasisPoints === undefined && body.fundIds === undefined),
      "Provide fundIds with growthBasisPoints, or an items list of per-fund deltas.",
    )
    .refine((body) => {
      const ids = body.items !== undefined ? body.items.map((item) => item.fundId) : (body.fundIds ?? [])
      return new Set(ids).size === ids.length
    }, "Each fund may appear at most once.") as S

export const collectivePlanBodySchema = (maxBasisPoints: number) =>
  withCollectiveRefinements(z.object(collectiveFields(maxBasisPoints)).strict())

export const collectiveCommitBodySchema = (maxBasisPoints: number) =>
  withCollectiveRefinements(
    z
      .object({
        ...collectiveFields(maxBasisPoints),
        basisHash: z.string().regex(/^[0-9a-f]{64}$/u, "must be the hash from the planning call"),
      })
      .strict(),
  )

const historyQuerySchema = z
  .object({ limit: limitSchema, after: z.string().min(1).optional() })
  .strict()

export interface CollectiveTargets {
  readonly fundIds: readonly string[]
  readonly instruction: CollectiveAumInstruction
}

export const collectiveTargets = (body: CollectiveShape): CollectiveTargets => {
  if (body.items !== undefined) {
    const items = [...body.items]
      .sort((left, right) => (left.fundId < right.fundId ? -1 : left.fundId > right.fundId ? 1 : 0))
      .map((item) => ({ fundId: item.fundId, growthPaise: BigInt(item.growthPaise) }))
    return { fundIds: items.map((item) => item.fundId), instruction: { type: "explicit_deltas", items } }
  }
  const fundIds = [...(body.fundIds ?? [])].sort()
  const growthBasisPoints = body.growthBasisPoints
  if (growthBasisPoints === undefined) throw new Error("collective instruction missing rate")
  return { fundIds, instruction: { type: "percentage", growthBasisPoints } }
}

export const basisOf = (snapshot: FundAumSnapshotRow): AumFundBasis => ({
  fundId: snapshot.fundId,
  latestSnapshotId: snapshot.id,
  aumPaise: BigInt(snapshot.aumPaise),
  revision: snapshot.revision,
})

export const AUM_ELIGIBLE_FUND_STATES = ["draft", "published", "paused"] as const

export const isAumEligible = (state: FundState): boolean =>
  (AUM_ELIGIBLE_FUND_STATES as readonly FundState[]).includes(state)

export const assertAumEligible = (
  requested: readonly string[],
  found: readonly { readonly id: string; readonly state: FundState }[],
): void => {
  if (found.length !== requested.length) throw new AppError("RESOURCE_NOT_FOUND")
  if (found.some((fund) => !isAumEligible(fund.state))) {
    throw new AppError("STATE_CONFLICT", {
      fields: { fundIds: ["an archived fund cannot receive an AUM publication"] },
    })
  }
}

const mapSnapshot = (row: FundAumSnapshotRow): Record<string, unknown> => ({
  id: row.id,
  fundId: row.fundId,
  asOfDate: row.asOfDate,
  revision: row.revision,
  aumPaise: row.aumPaise,
  reasonCode: row.reasonCode,
  note: row.note,
  growthBatchId: row.growthBatchId,
  publishedByUserId: row.publishedByUserId,
  requestId: row.requestId,
  createdAt: iso(row.createdAt),
})

const maxBasisPointsOf = (deps: AdminAumDeps): number =>
  deps.config.maxGrowthBasisPoints ?? DEFAULT_MAX_GROWTH_BASIS_POINTS

const lockWritableFund = async (deps: AdminAumDeps, tx: Transaction, fundId: string): Promise<void> => {
  const fund = await deps.aumRepository.lockFund(tx, fundId)
  if (fund === null) throw new AppError("RESOURCE_NOT_FOUND")
  if (!isAumEligible(fund.state)) {
    throw new AppError("STATE_CONFLICT", {
      fields: { fundId: ["an archived fund cannot receive an AUM publication"] },
    })
  }
}

const initializeAum = async (deps: AdminAumDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, ["aum.write"])
  deps.rateLimiter.hit(principal.userId || request.ip)
  const fundId = parseOrThrow(uuidParam, (request.params as { fundId?: unknown }).fundId)
  const body = parseOrThrow(initializeBodySchema, request.body)
  const key = requireIdempotencyKey(request)

  const result = await runAdminMutation({
    unitOfWork: deps.unitOfWork,
    idempotencyRepository: deps.idempotencyRepository,
    now: deps.clock(),
    idempotencyTtlMs: deps.config.idempotencyTtlMs,
    scope: adminIdempotencyScope(principal.userId, `${AUM_ROUTE}/funds/:fundId/initialize`, key),
    requestHash: hashRequest({ fundId, ...body }),
    execute: async (tx) => {
      await lockWritableFund(deps, tx, fundId)
      if ((await deps.aumRepository.findLatestSnapshot(tx, fundId)) !== null) {
        throw new AppError("STATE_CONFLICT")
      }
      const revision = ((await deps.aumRepository.findHighestRevision(tx, fundId, body.asOfDate)) ?? 0) + 1
      const batch = await deps.aumRepository.insertBatch(tx, {
        scope: "individual",
        instructionType: "amount",
        effectiveDate: body.asOfDate,
        reasonCode: body.reasonCode,
        note: body.note ?? null,
        basisHash: computeAumBasisHash(
          { command: "initialize", asOfDate: body.asOfDate, aumPaise: body.aumPaise },
          [],
        ),
        actorUserId: principal.userId,
        requestId: request.requestId,
        targetCount: 1,
        totalDeltaPaise: body.aumPaise,
      })
      const snapshot = await deps.aumRepository.insertSnapshot(tx, {
        fundId,
        asOfDate: body.asOfDate,
        revision,
        aumPaise: body.aumPaise,
        growthBatchId: batch.id,
        reasonCode: body.reasonCode,
        note: body.note ?? null,
        publishedByUserId: principal.userId,
        requestId: request.requestId,
      })
      await deps.auditRepository.append(tx, {
        actorType: "admin",
        actorUserId: principal.userId,
        command: "fund_aum.initialized",
        entityType: "fund_aum_snapshot",
        entityId: snapshot.id,
        toState: snapshot.aumPaise,
        requestId: request.requestId,
        entityVersion: snapshot.revision,
        metadata: {
          fundId,
          asOfDate: body.asOfDate,
          aumPaise: body.aumPaise,
          reasonCode: body.reasonCode,
          growthBatchId: batch.id,
          propagatedToClients: false,
        },
      })
      return { status: 201, body: { snapshot: mapSnapshot(snapshot), growthBatchId: batch.id } }
    },
  })
  return reply.sendData(result.body, {
    status: result.status,
    ...(result.replay ? { idempotencyReplay: true } : {}),
  })
}

const growAum = async (deps: AdminAumDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, ["aum.write"])
  deps.rateLimiter.hit(principal.userId || request.ip)
  const fundId = parseOrThrow(uuidParam, (request.params as { fundId?: unknown }).fundId)
  const body = parseOrThrow(growthBodySchema(maxBasisPointsOf(deps)), request.body)
  const key = requireIdempotencyKey(request)

  const result = await runAdminMutation({
    unitOfWork: deps.unitOfWork,
    idempotencyRepository: deps.idempotencyRepository,
    now: deps.clock(),
    idempotencyTtlMs: deps.config.idempotencyTtlMs,
    scope: adminIdempotencyScope(principal.userId, `${AUM_ROUTE}/funds/:fundId/growth`, key),
    requestHash: hashRequest({ fundId, ...body }),
    execute: async (tx) => {
      await lockWritableFund(deps, tx, fundId)
      const latest = await deps.aumRepository.findLatestSnapshot(tx, fundId)
      if (latest === null) throw new AppError("STATE_CONFLICT")
      if (body.asOfDate < latest.asOfDate) {
        throw new AppError("STATE_CONFLICT", {
          fields: { asOfDate: ["cannot be earlier than the basis snapshot it grows from"] },
        })
      }

      const instruction: AumGrowthInstruction =
        body.growthPaise !== undefined
          ? { kind: "amount", growthPaise: BigInt(body.growthPaise) }
          : { kind: "percentage", growthBasisPoints: BigInt(body.growthBasisPoints ?? 0) }
      const before = BigInt(latest.aumPaise)
      const delta = aumGrowthDelta(before, instruction)
      assertAumDeltaNonZero(delta)
      const after = before + delta
      if (after < 0n) throw new AppError("STATE_CONFLICT")

      const revision = ((await deps.aumRepository.findHighestRevision(tx, fundId, body.asOfDate)) ?? 0) + 1
      const instructionType = instruction.kind === "amount" ? "amount" : "percentage"
      const batch = await deps.aumRepository.insertBatch(tx, {
        scope: "individual",
        instructionType,
        effectiveDate: body.asOfDate,
        reasonCode: body.reasonCode,
        note: body.note ?? null,
        basisHash: computeAumBasisHash(
          { command: "growth", asOfDate: body.asOfDate, instructionType },
          [basisOf(latest)],
        ),
        actorUserId: principal.userId,
        requestId: request.requestId,
        targetCount: 1,
        totalDeltaPaise: delta.toString(),
      })
      const snapshot = await deps.aumRepository.insertSnapshot(tx, {
        fundId,
        asOfDate: body.asOfDate,
        revision,
        aumPaise: after.toString(),
        growthBatchId: batch.id,
        reasonCode: body.reasonCode,
        note: body.note ?? null,
        publishedByUserId: principal.userId,
        requestId: request.requestId,
      })
      await deps.auditRepository.append(tx, {
        actorType: "admin",
        actorUserId: principal.userId,
        command: "fund_aum.growth",
        entityType: "fund_aum_snapshot",
        entityId: snapshot.id,
        fromState: latest.aumPaise,
        toState: snapshot.aumPaise,
        requestId: request.requestId,
        entityVersion: snapshot.revision,
        metadata: {
          fundId,
          asOfDate: body.asOfDate,
          instructionType,
          deltaPaise: delta.toString(),
          reasonCode: body.reasonCode,
          growthBatchId: batch.id,
          propagatedToClients: false,
        },
      })
      return {
        status: 201,
        body: { snapshot: mapSnapshot(snapshot), growthBatchId: batch.id, deltaPaise: delta.toString() },
      }
    },
  })
  return reply.sendData(result.body, {
    status: result.status,
    ...(result.replay ? { idempotencyReplay: true } : {}),
  })
}

const correctSnapshot = async (deps: AdminAumDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, ["aum.write"])
  deps.rateLimiter.hit(principal.userId || request.ip)
  const snapshotId = parseOrThrow(uuidParam, (request.params as { snapshotId?: unknown }).snapshotId)
  const body = parseOrThrow(correctionBodySchema, request.body)
  const key = requireIdempotencyKey(request)

  const result = await runAdminMutation({
    unitOfWork: deps.unitOfWork,
    idempotencyRepository: deps.idempotencyRepository,
    now: deps.clock(),
    idempotencyTtlMs: deps.config.idempotencyTtlMs,
    scope: adminIdempotencyScope(principal.userId, `${AUM_ROUTE}/snapshots/:snapshotId/corrections`, key),
    requestHash: hashRequest({ snapshotId, ...body }),
    execute: async (tx) => {
      const target = await deps.aumRepository.findSnapshotById(tx, snapshotId)
      if (target === null) throw new AppError("RESOURCE_NOT_FOUND")
      await lockWritableFund(deps, tx, target.fundId)
      const highest = await deps.aumRepository.findHighestRevision(tx, target.fundId, target.asOfDate)
      if (highest !== target.revision) throw new AppError("STATE_CONFLICT")

      const correction = await deps.aumRepository.insertSnapshot(tx, {
        fundId: target.fundId,
        asOfDate: target.asOfDate,
        revision: target.revision + 1,
        aumPaise: body.aumPaise,
        growthBatchId: null,
        reasonCode: body.reasonCode,
        note: body.note ?? null,
        publishedByUserId: principal.userId,
        requestId: request.requestId,
      })
      await deps.auditRepository.append(tx, {
        actorType: "admin",
        actorUserId: principal.userId,
        command: "fund_aum.corrected",
        entityType: "fund_aum_snapshot",
        entityId: correction.id,
        fromState: target.aumPaise,
        toState: correction.aumPaise,
        requestId: request.requestId,
        entityVersion: correction.revision,
        metadata: {
          fundId: target.fundId,
          asOfDate: target.asOfDate,
          correctedSnapshotId: target.id,
          reasonCode: body.reasonCode,
          propagatedToClients: false,
        },
      })
      return { status: 201, body: { snapshot: mapSnapshot(correction) } }
    },
  })
  return reply.sendData(result.body, {
    status: result.status,
    ...(result.replay ? { idempotencyReplay: true } : {}),
  })
}

const listHistory = async (deps: AdminAumDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, ["aum.read"])
  const fundId = parseOrThrow(uuidParam, (request.params as { fundId?: unknown }).fundId)
  const query = parseOrThrow(historyQuerySchema, request.query)

  const existing = await deps.aumRepository.findExistingFundIds(deps.database, [fundId])
  if (existing.length === 0) throw new AppError("RESOURCE_NOT_FOUND")

  const now = deps.clock()
  const route = `${AUM_ROUTE}/funds/:fundId/history`
  const filterHash = computeFilterHash({ fundId })
  const cursor = readKeysetValues(deps.config.cursorKey, query.after, route, filterHash, now)
  const [afterAsOfDate, afterRevision, afterCreatedAt, afterId] = cursor
  const position =
    afterAsOfDate !== undefined
    && afterRevision !== undefined
    && afterCreatedAt !== undefined
    && afterId !== undefined
      ? {
          afterAsOfDate,
          afterRevision: Number(afterRevision),
          afterCreatedAt,
          afterId,
        }
      : {}

  const rows = await deps.aumRepository.listSnapshots(deps.database, fundId, {
    ...position,
    limit: query.limit + 1,
  })
  const { items, page } = paginate(
    deps.config.cursorKey,
    rows,
    query.limit,
    route,
    filterHash,
    now,
    (row) => [row.asOfDate, String(row.revision), iso(row.createdAt), row.id],
  )
  return reply.sendData({ items: items.map(mapSnapshot) }, { status: 200, page })
}

const commitCollectiveGrowth = async (deps: AdminAumDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, ["aum.write"])
  deps.rateLimiter.hit(principal.userId || request.ip)
  const body = parseOrThrow(collectiveCommitBodySchema(maxBasisPointsOf(deps)), request.body)
  const key = requireIdempotencyKey(request)
  const targets = collectiveTargets(body)

  const result = await runAdminMutation({
    unitOfWork: deps.unitOfWork,
    idempotencyRepository: deps.idempotencyRepository,
    now: deps.clock(),
    idempotencyTtlMs: deps.config.idempotencyTtlMs,
    scope: adminIdempotencyScope(principal.userId, `${AUM_ROUTE}/growth/collective`, key),
    requestHash: hashRequest({ ...body }),
    execute: async (tx) => {
      const locked = await deps.aumRepository.lockFunds(tx, targets.fundIds)
      assertAumEligible(targets.fundIds, locked)
      const latestRows = await deps.aumRepository.findLatestSnapshots(tx, targets.fundIds)
      if (latestRows.length !== targets.fundIds.length) {
        throw new AppError("STATE_CONFLICT")
      }
      if (latestRows.some((row) => body.asOfDate < row.asOfDate)) {
        throw new AppError("STATE_CONFLICT", {
          fields: { asOfDate: ["cannot be earlier than a basis snapshot it grows from"] },
        })
      }
      const bases = latestRows.map(basisOf)

      const command = canonicalCollectiveAumCommand(body.asOfDate, targets.instruction)
      const basisHash = computeAumBasisHash(command, bases)
      if (basisHash !== body.basisHash) throw new AppError("STATE_CONFLICT")

      const plan = planAumGrowth(bases, targets.instruction)
      if (!plan.ok) {
        throw new AppError("STATE_CONFLICT", {
          fields: { items: ["one or more funds would become negative"] },
        })
      }

      const batch = await deps.aumRepository.insertBatch(tx, {
        scope: "collective",
        instructionType: targets.instruction.type,
        effectiveDate: body.asOfDate,
        reasonCode: body.reasonCode,
        note: body.note ?? null,
        basisHash,
        actorUserId: principal.userId,
        requestId: request.requestId,
        targetCount: plan.items.length,
        totalDeltaPaise: plan.totalDeltaPaise.toString(),
      })

      const written: { fundId: string; snapshot: FundAumSnapshotRow; deltaPaise: bigint; beforeAumPaise: bigint }[] = []
      for (const item of plan.items) {
        const revision = ((await deps.aumRepository.findHighestRevision(tx, item.fundId, body.asOfDate)) ?? 0) + 1
        const snapshot = await deps.aumRepository.insertSnapshot(tx, {
          fundId: item.fundId,
          asOfDate: body.asOfDate,
          revision,
          aumPaise: item.afterAumPaise.toString(),
          growthBatchId: batch.id,
          reasonCode: body.reasonCode,
          note: body.note ?? null,
          publishedByUserId: principal.userId,
          requestId: request.requestId,
        })
        written.push({ fundId: item.fundId, snapshot, deltaPaise: item.deltaPaise, beforeAumPaise: item.beforeAumPaise })
      }

      await deps.auditRepository.append(tx, {
        actorType: "admin",
        actorUserId: principal.userId,
        command: "fund_aum.growth_collective",
        entityType: "aum_growth_batch",
        entityId: batch.id,
        requestId: request.requestId,
        entityVersion: 1,
        metadata: {
          instructionType: targets.instruction.type,
          targetCount: plan.items.length,
          totalDeltaPaise: plan.totalDeltaPaise.toString(),
          asOfDate: body.asOfDate,
          basisHash,
          reasonCode: body.reasonCode,
          propagatedToClients: false,
        },
      })

      return {
        status: 201,
        body: {
          growthBatchId: batch.id,
          targetCount: plan.items.length,
          totalDeltaPaise: plan.totalDeltaPaise.toString(),
          basisHash,
          items: written.map((entry) => ({
            fundId: entry.fundId,
            snapshotId: entry.snapshot.id,
            revision: entry.snapshot.revision,
            beforeAumPaise: entry.beforeAumPaise.toString(),
            deltaPaise: entry.deltaPaise.toString(),
            afterAumPaise: entry.snapshot.aumPaise,
          })),
        },
      }
    },
  })
  return reply.sendData(result.body, {
    status: result.status,
    ...(result.replay ? { idempotencyReplay: true } : {}),
  })
}

export const registerAdminAumRoutes = (application: FastifyInstance, deps: AdminAumDeps): void => {
  application.post(`${AUM_ROUTE}/funds/:fundId/initialize`, async (request, reply) =>
    initializeAum(deps, request, reply),
  )
  application.post(`${AUM_ROUTE}/funds/:fundId/growth`, async (request, reply) =>
    growAum(deps, request, reply),
  )
  application.post(`${AUM_ROUTE}/snapshots/:snapshotId/corrections`, async (request, reply) =>
    correctSnapshot(deps, request, reply),
  )
  application.get(`${AUM_ROUTE}/funds/:fundId/history`, async (request, reply) =>
    listHistory(deps, request, reply),
  )
  application.post(`${AUM_ROUTE}/growth/collective`, async (request, reply) =>
    commitCollectiveGrowth(deps, request, reply),
  )
}
