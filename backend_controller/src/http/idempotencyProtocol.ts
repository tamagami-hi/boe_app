/**
 * Database-backed idempotency (spec 04 §2.4, §3). The orchestrator is pure logic
 * over the `IdempotencyRepository` interface (§7): a caller-owned transaction
 * either wins the lock and executes, replays a byte-identical completed record,
 * or is rejected as reused / in-progress. The real repository implementation and
 * transaction wiring land with the first mutation route batch (BE-008).
 *
 * Named `idempotencyProtocol` (not `idempotency`) so it does not collide with the
 * legacy `src/http/idempotency.js` at module resolution time; the legacy file is
 * deleted in BE-019.
 */
import { z } from "zod"

import type {
  IdempotencyRepository,
  IdempotencyScope,
  Transaction,
} from "../db/repositories.js"

import { AppError } from "./errorCatalog.js"

/** `Idempotency-Key` header scalar (spec 04 §2.1). */
export const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/u)

export interface IdempotentOutcome<TBody> {
  readonly status: number
  readonly body: TBody
  readonly replay: boolean
}

export interface IdempotentExecution<TBody> {
  readonly repository: IdempotencyRepository
  readonly tx: Transaction
  readonly scope: IdempotencyScope
  readonly requestHash: Uint8Array
  readonly now: string
  readonly expiresAt: string
  readonly execute: () => Promise<{ readonly status: number; readonly body: TBody }>
}

const equalBytes = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0)
  }
  return difference === 0
}

/**
 * Run `execute` under the idempotency protocol. On a repeat call with the same
 * scope/key: a byte-identical completed record replays; a different request hash
 * is `IDEMPOTENCY_KEY_REUSED`; a still-running equivalent is
 * `IDEMPOTENCY_IN_PROGRESS` (Retry-After: 1).
 */
export const executeIdempotent = async <TBody>(
  params: IdempotentExecution<TBody>,
): Promise<IdempotentOutcome<TBody>> => {
  const { repository, tx, scope, requestHash } = params

  const acquired = await repository.tryAcquireTransactionLock(tx, scope)
  if (!acquired) {
    const completed = await repository.findCompleted(tx, scope)
    if (completed === null) {
      throw new AppError("IDEMPOTENCY_IN_PROGRESS", { retryAfterSeconds: 1 })
    }
    // `request_hash` is a bytea (Buffer) at runtime; ReadonlyDeep obscures the type.
    const storedHash = completed.request_hash as unknown as Uint8Array
    if (!equalBytes(storedHash, requestHash)) {
      throw new AppError("IDEMPOTENCY_KEY_REUSED")
    }
    return {
      status: completed.response_status,
      body: completed.response_body as TBody,
      replay: true,
    }
  }

  const result = await params.execute()
  await repository.insertCompleted(tx, {
    scope,
    requestHash,
    responseStatus: result.status,
    responseBody: result.body,
    completedAt: params.now,
    expiresAt: params.expiresAt,
  })
  return { status: result.status, body: result.body, replay: false }
}
