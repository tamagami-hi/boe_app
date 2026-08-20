/**
 * Admin client growth routes (spec §8.1/§8.2/§8.5, §9.4, §10). Web-cookie or
 * native-bearer transport, RBAC (`client_growth.write`), CSRF on all three
 * unsafe methods, `Idempotency-Key` on both commits.
 *
 *   POST /v1/admin/client-growth/individual          one (userId, fundId) position
 *   POST /v1/admin/client-growth/collective/preview  write-free preview + basisHash
 *   POST /v1/admin/client-growth/collective          commit against a preview basisHash
 *
 * These commands change client-displayed values only. They never read or write
 * fund AUM: the audit event metadata says so explicitly
 * (`CLIENT_GROWTH_AUDIT_METADATA`), and the architecture guard fails the build
 * if this module references the sibling domain.
 *
 * Money on the wire is decimal strings; internally all paise are `bigint`.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { Kysely } from "kysely"
import { z } from "zod"

import type { UnitOfWork } from "../db/database.js"
import type { IdempotencyRepository, Transaction } from "../db/repositories.js"
import type { Database } from "../db/types.js"
import { requireAnyPermission, resolveAdminPrincipal } from "../domain/admin/adminAccess.js"
import {
  computeClientGrowthBasisHash,
  MAX_COLLECTIVE_CLIENT_TARGETS,
  MIN_GROWTH_BASIS_POINTS,
  planCollectiveClientGrowth,
  planIndividualGrowth,
  type ClientPositionBasis,
  type CollectiveGrowthInstruction,
  type GrowthInstruction,
  type PlannedGrowthTarget,
} from "../domain/admin/clientGrowth.js"
import type { WebAuthDeps } from "../domain/auth/webAuth.js"
import { CLIENT_GROWTH_AUDIT_METADATA } from "../domain/shared/growthAuditMetadata.js"
import { AppError } from "../http/errorCatalog.js"
import { parseOrThrow } from "../http/validation.js"
import type { AuditWriteRepository } from "../repositories/auditRepository.js"
import type {
  ClientGrowthRepository,
  ClientPositionBasisRow,
} from "../repositories/clientGrowthRepository.js"
import type { NotificationWriteRepository } from "../repositories/notificationRepository.js"
import {
  adminIdempotencyScope,
  hashRequest,
  reasonCodeSchema,
  reasonDetailSchema,
  requireIdempotencyKey,
  uuidParam,
  type AdminMutationResult,
} from "./adminRouteKit.js"

export interface AdminClientGrowthConfig {
  readonly idempotencyTtlMs: number
  /** Positive business maximum for a signed growth rate in basis points (§8.1). */
  readonly maxBasisPoints: number
}

export interface AdminClientGrowthDeps {
  readonly webAuth: WebAuthDeps
  readonly unitOfWork: UnitOfWork
  readonly database: Kysely<Database>
  readonly clock: () => Date
  readonly config: AdminClientGrowthConfig
  readonly clientGrowthRepository: ClientGrowthRepository
  readonly auditRepository: AuditWriteRepository
  readonly idempotencyRepository: IdempotencyRepository
  readonly notificationRepository: NotificationWriteRepository
}

const INDIVIDUAL_ROUTE = "/v1/admin/client-growth/individual"
const COLLECTIVE_PREVIEW_ROUTE = "/v1/admin/client-growth/collective/preview"
const COLLECTIVE_ROUTE = "/v1/admin/client-growth/collective"

/** §8.5 hash command identities; preview and commit must agree on them. */
const COMMAND_INDIVIDUAL = "client-growth.individual"
const COMMAND_COLLECTIVE_PERCENTAGE = "client-growth.collective.percentage"
const COMMAND_COLLECTIVE_EXPLICIT = "client-growth.collective.explicit_deltas"

/** Generic client notification copy: no amounts, reason codes, or notes (§10). */
const NOTIFICATION_KIND = "client_value_updated"
const NOTIFICATION_TITLE = "Investment value updated"
const NOTIFICATION_BODY =
  "The value of one of your investments was updated. Open your portfolio to see the current value."

// --- schemas ---

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, "must be a YYYY-MM-DD date")
/** Signed integer paise as a decimal string; bounded to the bigint range. */
const signedPaiseSchema = z
  .string()
  .trim()
  .regex(/^-?\d{1,19}$/u, "must be a signed integer paise string")
const basisHashSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/u, "must be the basis hash returned by the preview")

const buildSchemas = (maxBasisPoints: number) => {
  const growthBasisPointsSchema = z.coerce
    .number()
    .int()
    .min(MIN_GROWTH_BASIS_POINTS)
    .max(maxBasisPoints)

  const individualSchema = z
    .object({
      userId: uuidParam,
      fundId: uuidParam,
      growthPaise: signedPaiseSchema.optional(),
      growthBasisPoints: growthBasisPointsSchema.optional(),
      effectiveDate: dateSchema,
      reasonCode: reasonCodeSchema,
      note: reasonDetailSchema.optional(),
    })
    .strict()
    .refine(
      (value) => (value.growthPaise === undefined) !== (value.growthBasisPoints === undefined),
      { message: "Provide exactly one of growthPaise or growthBasisPoints." },
    )

  const collectiveBase = z
    .object({
      fundId: uuidParam,
      growthBasisPoints: growthBasisPointsSchema.optional(),
      items: z
        .array(z.object({ userId: uuidParam, growthPaise: signedPaiseSchema }).strict())
        .min(1)
        .max(MAX_COLLECTIVE_CLIENT_TARGETS)
        .optional(),
    })
    .strict()
  const exactlyOneMode = (value: {
    growthBasisPoints?: number | undefined
    items?: unknown[] | undefined
  }): boolean => (value.growthBasisPoints === undefined) !== (value.items === undefined)
  const modeMessage = { message: "Provide exactly one of growthBasisPoints or items." }

  const collectivePreviewSchema = collectiveBase.refine(exactlyOneMode, modeMessage)
  const collectiveCommitSchema = collectiveBase
    .extend({
      basisHash: basisHashSchema,
      effectiveDate: dateSchema,
      reasonCode: reasonCodeSchema,
      note: reasonDetailSchema.optional(),
    })
    .strict()
    .refine(exactlyOneMode, modeMessage)

  return { individualSchema, collectivePreviewSchema, collectiveCommitSchema }
}

// --- serialization ---

/** Admin console reads defensively across both legacy and current key names. */
const mapTarget = (target: PlannedGrowthTarget): Record<string, unknown> => ({
  userId: target.userId,
  beforePaise: target.beforePaise.toString(),
  currentValuePaise: target.beforePaise.toString(),
  deltaPaise: target.deltaPaise.toString(),
  growthPaise: target.deltaPaise.toString(),
  afterPaise: target.afterPaise.toString(),
  newValuePaise: target.afterPaise.toString(),
})

const toDomainBasis = (row: ClientPositionBasisRow): ClientPositionBasis => ({
  userId: row.userId,
  currentValuePaise: BigInt(row.currentValuePaise),
  latestEntryId: row.latestEntryId,
})

// --- commit plumbing ---

/** Constant-time byte compare, mirroring the idempotency protocol's own. */
const equalBytes = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0)
  }
  return difference === 0
}

interface GrowthCommitExecution<TBody> {
  readonly status: number
  readonly body: TBody
  readonly batchId: string
}

/**
 * The canonical idempotency protocol (replay → lock → recheck → execute →
 * record) with one extension: the committed record's id is written back onto
 * the growth batch in the same transaction (§5.9 — the batch references the
 * canonical idempotency record instead of storing a free-standing raw key).
 */
const runGrowthCommit = async <TBody extends Record<string, unknown>>(
  deps: AdminClientGrowthDeps,
  request: FastifyRequest,
  routeTemplate: string,
  canonical: Readonly<Record<string, unknown>>,
  principalUserId: string,
  execute: (tx: Transaction) => Promise<GrowthCommitExecution<TBody>>,
): Promise<AdminMutationResult<TBody>> => {
  const key = requireIdempotencyKey(request)
  const now = deps.clock()
  const scope = adminIdempotencyScope(principalUserId, routeTemplate, key)
  const requestHash = hashRequest(canonical)

  return deps.unitOfWork.execute(async (tx) => {
    const repository = deps.idempotencyRepository
    const replayIfCompleted = async (): Promise<AdminMutationResult<TBody> | null> => {
      const completed = await repository.findCompleted(tx, scope)
      if (completed === null) return null
      // `request_hash` is a bytea (Buffer) at runtime; ReadonlyDeep obscures it.
      const storedHash = completed.request_hash as unknown as Uint8Array
      if (!equalBytes(storedHash, requestHash)) {
        throw new AppError("IDEMPOTENCY_KEY_REUSED")
      }
      return { status: completed.response_status, body: completed.response_body as TBody, replay: true }
    }

    const alreadyCompleted = await replayIfCompleted()
    if (alreadyCompleted !== null) return alreadyCompleted

    const acquired = await repository.tryAcquireTransactionLock(tx, scope)
    if (!acquired) {
      const completedUnderRace = await replayIfCompleted()
      if (completedUnderRace !== null) return completedUnderRace
      throw new AppError("IDEMPOTENCY_IN_PROGRESS", { retryAfterSeconds: 1 })
    }

    const completedAfterAcquire = await replayIfCompleted()
    if (completedAfterAcquire !== null) return completedAfterAcquire

    const result = await execute(tx)
    const record = await repository.insertCompleted(tx, {
      scope,
      requestHash,
      responseStatus: result.status,
      responseBody: result.body,
      completedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + deps.config.idempotencyTtlMs).toISOString(),
    })
    await deps.clientGrowthRepository.linkBatchIdempotencyRecord(tx, result.batchId, record.id)
    return { status: result.status, body: result.body, replay: false }
  })
}

const resolveWriter = async (
  deps: AdminClientGrowthDeps,
  request: FastifyRequest,
): Promise<{ readonly userId: string }> => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, ["client_growth.write"])
  return principal
}

// --- handlers ---

const individual = async (
  deps: AdminClientGrowthDeps,
  schemas: ReturnType<typeof buildSchemas>,
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const principal = await resolveWriter(deps, request)
  const body = parseOrThrow(schemas.individualSchema, request.body)

  const instruction: GrowthInstruction =
    body.growthPaise !== undefined
      ? { kind: "amount", growthPaise: BigInt(body.growthPaise) }
      : { kind: "percentage", growthBasisPoints: BigInt(body.growthBasisPoints!) }
  const canonical: Record<string, unknown> = {
    userId: body.userId,
    fundId: body.fundId,
    ...(body.growthPaise !== undefined ? { growthPaise: body.growthPaise } : {}),
    ...(body.growthBasisPoints !== undefined ? { growthBasisPoints: body.growthBasisPoints } : {}),
    effectiveDate: body.effectiveDate,
    reasonCode: body.reasonCode,
    ...(body.note !== undefined ? { note: body.note } : {}),
  }

  const result = await runGrowthCommit(
    deps,
    request,
    INDIVIDUAL_ROUTE,
    canonical,
    principal.userId,
    async (tx) => {
      // §8.5: lock the position, then recalculate from the current server
      // basis — the commit response is authoritative.
      await deps.clientGrowthRepository.lockPosition(tx, body.userId, body.fundId)
      const basis = await deps.clientGrowthRepository.findPositionBasis(tx, body.userId, body.fundId)
      if (basis === null) throw new AppError("RESOURCE_NOT_FOUND")
      const currentValue = BigInt(basis.currentValuePaise)
      const plan = planIndividualGrowth(currentValue, instruction, BigInt(deps.config.maxBasisPoints))
      const basisHash = computeClientGrowthBasisHash(COMMAND_INDIVIDUAL, body.fundId, [
        { userId: body.userId, currentValuePaise: currentValue, latestEntryId: basis.latestEntryId },
      ])

      const batch = await deps.clientGrowthRepository.insertBatch(tx, {
        scope: "individual",
        instructionType: instruction.kind,
        effectiveDate: body.effectiveDate,
        reasonCode: body.reasonCode,
        note: body.note ?? null,
        basisHash,
        actorUserId: principal.userId,
        requestId: request.requestId,
        targetCount: 1,
        totalDeltaPaise: plan.deltaPaise,
      })
      const entry = await deps.clientGrowthRepository.insertGrowthEntry(tx, {
        batchId: batch.id,
        userId: body.userId,
        fundId: body.fundId,
        valueDeltaPaise: plan.deltaPaise,
        effectiveDate: body.effectiveDate,
        reasonCode: body.reasonCode,
        note: body.note ?? null,
        actorUserId: principal.userId,
        requestId: request.requestId,
      })
      await deps.auditRepository.append(tx, {
        actorType: "admin",
        actorUserId: principal.userId,
        command: "client_growth.individual",
        entityType: "client_growth_batch",
        entityId: batch.id,
        requestId: request.requestId,
        entityVersion: 1,
        metadata: {
          fundId: body.fundId,
          userId: body.userId,
          scope: "individual",
          instructionType: instruction.kind,
          effectiveDate: body.effectiveDate,
          reasonCode: body.reasonCode,
          targetCount: 1,
          totalDeltaPaise: plan.deltaPaise.toString(),
          ...CLIENT_GROWTH_AUDIT_METADATA,
        },
      })
      await deps.notificationRepository.create(tx, {
        userId: body.userId,
        kind: NOTIFICATION_KIND,
        title: NOTIFICATION_TITLE,
        body: NOTIFICATION_BODY,
        payload: { fundId: body.fundId },
      })

      return {
        status: 201,
        batchId: batch.id,
        body: {
          batchId: batch.id,
          entryId: entry.id,
          userId: body.userId,
          fundId: body.fundId,
          effectiveDate: body.effectiveDate,
          reasonCode: body.reasonCode,
          ...mapTarget({ userId: body.userId, ...plan }),
        },
      }
    },
  )
  return reply.sendData(result.body, {
    status: result.status,
    ...(result.replay ? { idempotencyReplay: true } : {}),
  })
}

const collectiveInstruction = (body: {
  readonly growthBasisPoints?: number | undefined
  readonly items?: readonly Readonly<{ userId: string; growthPaise: string }>[] | undefined
}): CollectiveGrowthInstruction =>
  body.growthBasisPoints !== undefined
    ? { kind: "percentage", growthBasisPoints: BigInt(body.growthBasisPoints) }
    : {
        kind: "explicit_deltas",
        items: (body.items ?? []).map((item) => ({
          userId: item.userId,
          growthPaise: BigInt(item.growthPaise),
        })),
      }

const collectiveCommand = (instruction: CollectiveGrowthInstruction): string =>
  instruction.kind === "percentage" ? COMMAND_COLLECTIVE_PERCENTAGE : COMMAND_COLLECTIVE_EXPLICIT

const collectivePreview = async (
  deps: AdminClientGrowthDeps,
  schemas: ReturnType<typeof buildSchemas>,
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const principal = await resolveWriter(deps, request)
  const body = parseOrThrow(schemas.collectivePreviewSchema, request.body)
  const instruction = collectiveInstruction(body)

  // Preview writes nothing and takes no locks (§8.5).
  const rows = await deps.clientGrowthRepository.listFundPositionBases(deps.database, body.fundId)
  const positions = rows.map(toDomainBasis)
  const plan = planCollectiveClientGrowth(positions, instruction, {
    maxTargets: MAX_COLLECTIVE_CLIENT_TARGETS,
    maxBasisPoints: BigInt(deps.config.maxBasisPoints),
  })
  const basisHash = computeClientGrowthBasisHash(collectiveCommand(instruction), body.fundId, positions)

  const targets = plan.targets.map(mapTarget)
  return reply.sendData(
    {
      fundId: body.fundId,
      mode: plan.instructionType,
      basisHash,
      excludedCount: plan.excludedCount,
      targetCount: plan.targets.length,
      totalDeltaPaise: plan.totalDeltaPaise.toString(),
      targets,
      items: targets,
    },
    { status: 200 },
  )
}

const collectiveCommit = async (
  deps: AdminClientGrowthDeps,
  schemas: ReturnType<typeof buildSchemas>,
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const principal = await resolveWriter(deps, request)
  const body = parseOrThrow(schemas.collectiveCommitSchema, request.body)
  const instruction = collectiveInstruction(body)
  const command = collectiveCommand(instruction)
  const canonical: Record<string, unknown> = {
    fundId: body.fundId,
    ...(body.growthBasisPoints !== undefined ? { growthBasisPoints: body.growthBasisPoints } : {}),
    ...(body.items !== undefined ? { items: body.items } : {}),
    basisHash: body.basisHash,
    effectiveDate: body.effectiveDate,
    reasonCode: body.reasonCode,
    ...(body.note !== undefined ? { note: body.note } : {}),
  }

  const result = await runGrowthCommit(
    deps,
    request,
    COLLECTIVE_ROUTE,
    canonical,
    principal.userId,
    async (tx) => {
      // §8.5: lock every position in deterministic order, reload the bases,
      // and refuse to commit against a stale preview.
      const initial = await deps.clientGrowthRepository.listFundPositionBases(tx, body.fundId)
      for (const row of initial) {
        await deps.clientGrowthRepository.lockPosition(tx, row.userId, body.fundId)
      }
      const reloaded = await deps.clientGrowthRepository.listFundPositionBases(tx, body.fundId)
      const positions = reloaded.map(toDomainBasis)
      const basisHash = computeClientGrowthBasisHash(command, body.fundId, positions)
      if (basisHash !== body.basisHash) {
        throw new AppError("STATE_CONFLICT", {
          message: "The client value basis changed after the preview; run the preview again.",
        })
      }
      // Deltas are always recomputed on the server; browser deltas are never trusted.
      const plan = planCollectiveClientGrowth(positions, instruction, {
        maxTargets: MAX_COLLECTIVE_CLIENT_TARGETS,
        maxBasisPoints: BigInt(deps.config.maxBasisPoints),
      })

      const batch = await deps.clientGrowthRepository.insertBatch(tx, {
        scope: "collective",
        instructionType: plan.instructionType,
        effectiveDate: body.effectiveDate,
        reasonCode: body.reasonCode,
        note: body.note ?? null,
        basisHash,
        actorUserId: principal.userId,
        requestId: request.requestId,
        targetCount: plan.targets.length,
        totalDeltaPaise: plan.totalDeltaPaise,
      })
      for (const target of plan.targets) {
        await deps.clientGrowthRepository.insertGrowthEntry(tx, {
          batchId: batch.id,
          userId: target.userId,
          fundId: body.fundId,
          valueDeltaPaise: target.deltaPaise,
          effectiveDate: body.effectiveDate,
          reasonCode: body.reasonCode,
          note: body.note ?? null,
          actorUserId: principal.userId,
          requestId: request.requestId,
        })
        await deps.notificationRepository.create(tx, {
          userId: target.userId,
          kind: NOTIFICATION_KIND,
          title: NOTIFICATION_TITLE,
          body: NOTIFICATION_BODY,
          payload: { fundId: body.fundId },
        })
      }
      await deps.auditRepository.append(tx, {
        actorType: "admin",
        actorUserId: principal.userId,
        command: "client_growth.collective",
        entityType: "client_growth_batch",
        entityId: batch.id,
        requestId: request.requestId,
        entityVersion: 1,
        metadata: {
          fundId: body.fundId,
          scope: "collective",
          instructionType: plan.instructionType,
          effectiveDate: body.effectiveDate,
          reasonCode: body.reasonCode,
          targetCount: plan.targets.length,
          excludedCount: plan.excludedCount,
          totalDeltaPaise: plan.totalDeltaPaise.toString(),
          ...CLIENT_GROWTH_AUDIT_METADATA,
        },
      })

      const targets = plan.targets.map(mapTarget)
      return {
        status: 201,
        batchId: batch.id,
        body: {
          batchId: batch.id,
          fundId: body.fundId,
          mode: plan.instructionType,
          effectiveDate: body.effectiveDate,
          excludedCount: plan.excludedCount,
          targetCount: plan.targets.length,
          totalDeltaPaise: plan.totalDeltaPaise.toString(),
          targets,
          items: targets,
        },
      }
    },
  )
  return reply.sendData(result.body, {
    status: result.status,
    ...(result.replay ? { idempotencyReplay: true } : {}),
  })
}

export const registerAdminClientGrowthRoutes = (
  application: FastifyInstance,
  deps: AdminClientGrowthDeps,
): void => {
  const schemas = buildSchemas(deps.config.maxBasisPoints)
  application.post(INDIVIDUAL_ROUTE, (request, reply) => individual(deps, schemas, request, reply))
  application.post(COLLECTIVE_PREVIEW_ROUTE, (request, reply) =>
    collectivePreview(deps, schemas, request, reply),
  )
  application.post(COLLECTIVE_ROUTE, (request, reply) => collectiveCommit(deps, schemas, request, reply))
}
