import { createHash } from "node:crypto"

import type { FastifyRequest } from "fastify"
import { z } from "zod"

import type { UnitOfWork } from "../db/database.js"
import type { IdempotencyRepository, IdempotencyScope, Transaction } from "../db/repositories.js"
import { computeFilterHash } from "../http/cursor.js"
import { MAX_PAGE_LIMIT } from "../http/pagination.js"
import { AppError } from "../http/errorCatalog.js"
import { executeIdempotent, idempotencyKeySchema } from "../http/idempotencyProtocol.js"

export const MAX_ADMIN_LIMIT = MAX_PAGE_LIMIT

export const limitSchema = z.coerce.number().int().min(1).max(MAX_ADMIN_LIMIT).default(25)
export const uuidParam = z.string().uuid()
export const reasonCodeSchema = z.string().trim().min(1).max(80)
export const reasonDetailSchema = z.string().trim().min(1).max(2000)
export const searchSchema = z.string().trim().min(1).max(120)
export const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, "must be a lowercase hyphenated slug")

export const iso = (value: Date | string): string => new Date(value).toISOString()
export const isoOrNull = (value: Date | string | null): string | null =>
  value === null ? null : iso(value)
export const numberOrNull = (value: number | string | null): number | null =>
  value === null ? null : Number(value)

export const versionNumber = (value: unknown): number => Number(value)

export { computeFilterHash }

export const requireIdempotencyKey = (request: FastifyRequest): string => {
  const header = request.headers["idempotency-key"]
  const value = Array.isArray(header) ? header[0] : header
  const parsed = idempotencyKeySchema.safeParse(value)
  if (!parsed.success) {
    throw new AppError("VALIDATION_FAILED", {
      fields: { "idempotency-key": ["a valid Idempotency-Key header is required"] },
    })
  }
  return parsed.data
}

export const optionalIdempotencyKey = (request: FastifyRequest): string | null => {
  const header = request.headers["idempotency-key"]
  const value = Array.isArray(header) ? header[0] : header
  if (value === undefined || value === "") return null
  const parsed = idempotencyKeySchema.safeParse(value)
  if (!parsed.success) {
    throw new AppError("VALIDATION_FAILED", {
      fields: { "idempotency-key": ["a valid Idempotency-Key header is required"] },
    })
  }
  return parsed.data
}

export const parseIfMatchVersion = (request: FastifyRequest): number => {
  const value = request.headers["if-match"]
  const match = typeof value === "string" ? /^"?(\d+)"?$/u.exec(value.trim()) : null
  const captured = match?.[1]
  if (captured === undefined) {
    throw new AppError("VALIDATION_FAILED", {
      fields: { "if-match": ["a quoted integer version is required"] },
    })
  }
  return Number(captured)
}

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (typeof value === "bigint") return value.toString()
  if (value === null || typeof value !== "object") return value
  const source = value as Record<string, unknown>
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(source).sort()) {
    if (source[key] === undefined) continue
    sorted[key] = canonicalize(source[key])
  }
  return sorted
}

export const hashRequest = (canonical: Readonly<Record<string, unknown>>): Buffer =>
  createHash("sha256").update(JSON.stringify(canonicalize(canonical))).digest()

export const adminIdempotencyScope = (
  userId: string,
  routeTemplate: string,
  key: string,
  method: "POST" | "PATCH" | "DELETE" = "POST",
): IdempotencyScope => ({
  actorScope: `admin:${userId}`,
  actorScopeKeyVersion: null,
  candidateActorScopes: [`admin:${userId}`],
  method,
  routeTemplate,
  key,
})

export interface AdminMutationOptions<TBody> {
  readonly unitOfWork: UnitOfWork
  readonly idempotencyRepository: IdempotencyRepository
  readonly now: Date
  readonly idempotencyTtlMs: number
  readonly scope: IdempotencyScope
  readonly requestHash: Buffer
  readonly execute: (tx: Transaction) => Promise<{ readonly status: number; readonly body: TBody }>
}

export interface AdminMutationResult<TBody> {
  readonly status: number
  readonly body: TBody
  readonly replay: boolean
}

export const runAdminMutation = async <TBody extends Record<string, unknown>>(
  options: AdminMutationOptions<TBody>,
): Promise<AdminMutationResult<TBody>> =>
  options.unitOfWork.execute((tx) =>
    executeIdempotent<TBody>({
      repository: options.idempotencyRepository,
      tx,
      scope: options.scope,
      requestHash: options.requestHash,
      now: options.now.toISOString(),
      expiresAt: new Date(options.now.getTime() + options.idempotencyTtlMs).toISOString(),
      execute: async () => options.execute(tx),
    }),
  )
