/**
 * Response envelope builders (spec 04 §2.2). Every JSON endpoint except the SNS
 * webhook returns exactly one success or error envelope.
 */
import type { ErrorCode } from "./errorCatalog.js"

export interface PageMeta {
  readonly nextCursor: string | null
  readonly limit: number
  readonly hasMore: boolean
}

export interface EnvelopeMeta {
  readonly requestId: string
  readonly timestamp: string
  readonly idempotencyReplay?: boolean
  readonly page?: PageMeta
}

export interface SuccessEnvelope<TData> {
  readonly ok: true
  readonly data: TData
  readonly error: null
  readonly meta: EnvelopeMeta
}

export interface EnvelopeError {
  readonly code: ErrorCode
  readonly message: string
  readonly fields?: Readonly<Record<string, readonly string[]>>
  readonly retryable: boolean
}

export interface ErrorEnvelope {
  readonly ok: false
  readonly data: null
  readonly error: EnvelopeError
  readonly meta: EnvelopeMeta
}

export interface MetaInput {
  readonly requestId: string
  readonly timestamp?: string
  readonly idempotencyReplay?: boolean
  readonly page?: PageMeta
}

const buildMeta = (meta: MetaInput): EnvelopeMeta => {
  const base: EnvelopeMeta = {
    requestId: meta.requestId,
    timestamp: meta.timestamp ?? new Date().toISOString(),
  }
  return {
    ...base,
    ...(meta.idempotencyReplay === undefined ? {} : { idempotencyReplay: meta.idempotencyReplay }),
    ...(meta.page === undefined ? {} : { page: meta.page }),
  }
}

export const successEnvelope = <TData>(data: TData, meta: MetaInput): SuccessEnvelope<TData> => ({
  ok: true,
  data,
  error: null,
  meta: buildMeta(meta),
})

export const errorEnvelope = (error: EnvelopeError, meta: MetaInput): ErrorEnvelope => ({
  ok: false,
  data: null,
  error,
  meta: buildMeta(meta),
})
