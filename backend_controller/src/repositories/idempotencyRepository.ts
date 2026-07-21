/**
 * Idempotency repository (spec 03 §7, 04 §2.4/§3). Implements the transaction
 * lock via a non-blocking PostgreSQL advisory lock keyed on the request scope,
 * and the completed-record store used to replay a prior response.
 */
import { createHash } from "node:crypto"

import { sql } from "kysely"

import type {
  CompleteIdempotencyInput,
  IdempotencyRecord,
  IdempotencyRepository,
  IdempotencyScope,
  Transaction,
} from "../db/repositories.js"

const advisoryLockKey = (scope: IdempotencyScope): string => {
  const digest = createHash("sha256")
    .update(`${scope.actorScope}|${scope.method}|${scope.routeTemplate}|${scope.key}`)
    .digest()
  // Returned as text and cast to bigint in SQL; node-postgres does not serialize
  // a JS BigInt parameter.
  return digest.readBigInt64BE(0).toString()
}

export const createIdempotencyRepository = (): IdempotencyRepository => ({
  tryAcquireTransactionLock: async (tx: Transaction, scope: IdempotencyScope): Promise<boolean> => {
    const result = await sql<{ locked: boolean }>`
      select pg_try_advisory_xact_lock(${advisoryLockKey(scope)}::bigint) as locked
    `.execute(tx)
    return result.rows[0]?.locked ?? false
  },

  findCompleted: async (tx: Transaction, scope: IdempotencyScope): Promise<IdempotencyRecord | null> => {
    const row = await tx
      .selectFrom("idempotency_records")
      .selectAll()
      .where("actor_scope", "=", scope.actorScope)
      .where("http_method", "=", scope.method)
      .where("route_template", "=", scope.routeTemplate)
      .where("key", "=", scope.key)
      .where("expires_at", ">", new Date())
      .executeTakeFirst()
    return row ?? null
  },

  insertCompleted: async (
    tx: Transaction,
    input: CompleteIdempotencyInput,
  ): Promise<IdempotencyRecord> =>
    tx
      .insertInto("idempotency_records")
      .values({
        actor_scope: input.scope.actorScope,
        actor_scope_key_version: input.scope.actorScopeKeyVersion,
        http_method: input.scope.method,
        route_template: input.scope.routeTemplate,
        key: input.scope.key,
        request_hash: Buffer.from(input.requestHash),
        response_status: input.responseStatus,
        response_body: JSON.stringify(input.responseBody),
        // created_at and completed_at both default to the transaction time, so
        // completed_at >= created_at holds; expires_at is supplied by the caller.
        expires_at: input.expiresAt,
      })
      .returningAll()
      .executeTakeFirstOrThrow(),
})
