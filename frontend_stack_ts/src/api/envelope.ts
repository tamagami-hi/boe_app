import { ErrorEnvelope } from "@beonedge/contracts"
import type { ErrorCode } from "@beonedge/contracts"

import { parsePageMeta } from "~/api/cursor"
import type { PageMeta } from "~/api/cursor"
import { isErrorCode } from "~/api/errors"
import type { FieldErrors } from "~/api/errors"

export type ResponseMeta = Readonly<{
  requestId: string | null
  timestamp: string | null
  idempotencyReplay: boolean
  page: PageMeta | null
}>

export type ParsedError = Readonly<{
  code: ErrorCode
  message: string
  retryable: boolean
  fields: FieldErrors | null
}>

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

export const readResponseMeta = (body: unknown): ResponseMeta => {
  const envelope = asRecord(body)
  const meta = envelope === null ? null : asRecord(envelope.meta)
  if (meta === null) {
    return { requestId: null, timestamp: null, idempotencyReplay: false, page: null }
  }
  return {
    requestId: typeof meta.requestId === "string" ? meta.requestId : null,
    timestamp: typeof meta.timestamp === "string" ? meta.timestamp : null,
    idempotencyReplay: meta.idempotencyReplay === true,
    page: parsePageMeta(meta.page),
  }
}

export const isSuccessEnvelope = (body: unknown): boolean => {
  const envelope = asRecord(body)
  return envelope !== null && envelope.ok === true
}

export const readError = (body: unknown): ParsedError | null => {
  const parsed = ErrorEnvelope.safeParse(body)
  if (parsed.success) {
    const detail = parsed.data.error
    return {
      code: detail.code,
      message: detail.message,
      retryable: detail.retryable,
      fields: "fields" in detail && detail.fields !== undefined ? detail.fields : null,
    }
  }

  const envelope = asRecord(body)
  const detail = envelope === null ? null : asRecord(envelope.error)
  if (detail === null) return null
  if (!isErrorCode(detail.code)) return null
  return {
    code: detail.code,
    message: typeof detail.message === "string" ? detail.message : "The request failed.",
    retryable: detail.retryable === true,
    fields: null,
  }
}
