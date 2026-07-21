/**
 * Append-only audit repository (spec 03 §3.3/§7). Records who did what to which
 * entity; metadata is a redacted JSON object and never carries secrets or PII.
 */
import type { AuditEvent, Transaction } from "../db/repositories.js"
import type { ActorType } from "../db/types.js"

export interface AppendAuditInput {
  readonly actorType: ActorType
  readonly actorUserId?: string | null
  readonly command: string
  readonly entityType: string
  readonly entityId: string
  readonly fromState?: string | null
  readonly toState?: string | null
  readonly requestId: string
  readonly entityVersion: number
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface AuditWriteRepository {
  append: (tx: Transaction, input: AppendAuditInput) => Promise<AuditEvent>
}

export const createAuditRepository = (): AuditWriteRepository => ({
  append: async (tx, input) =>
    tx
      .insertInto("audit_events")
      .values({
        actor_type: input.actorType,
        actor_user_id: input.actorUserId ?? null,
        command: input.command,
        entity_type: input.entityType,
        entity_id: input.entityId,
        from_state: input.fromState ?? null,
        to_state: input.toState ?? null,
        request_id: input.requestId,
        entity_version: input.entityVersion,
        metadata: JSON.stringify(input.metadata ?? {}),
      })
      .returningAll()
      .executeTakeFirstOrThrow(),
})
