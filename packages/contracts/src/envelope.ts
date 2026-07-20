import { z } from "zod"

import { ERROR_CODES, ERROR_DEFINITIONS } from "./errors.js"
import type { ErrorCode as ErrorCodeType } from "./errors.js"
import { IsoDateTime, Uuid } from "./scalars.js"

const PROTOTYPE_SENSITIVE_FIELD_KEYS = ["__proto__", "prototype", "constructor"] as const
const RESERVED_METADATA_KEYS = ["requestId", "timestamp", "idempotencyReplay"] as const

const BASE_METADATA_SHAPE = {
  requestId: Uuid,
  timestamp: IsoDateTime,
  idempotencyReplay: z.boolean().optional(),
} as const

type MetadataShape = Readonly<Record<string, z.ZodType>>
type RetryableErrorCode = {
  [TCode in ErrorCodeType]: (typeof ERROR_DEFINITIONS)[TCode]["retryable"] extends true
    ? TCode
    : never
}[ErrorCodeType]
type NonValidationNonRetryableErrorCode = Exclude<
  ErrorCodeType,
  "VALIDATION_FAILED" | RetryableErrorCode
>

const RETRYABLE_ERROR_CODES = ERROR_CODES.filter(
  (code): code is RetryableErrorCode => ERROR_DEFINITIONS[code].retryable,
)
const NON_VALIDATION_NON_RETRYABLE_ERROR_CODES = ERROR_CODES.filter(
  (code): code is NonValidationNonRetryableErrorCode =>
    code !== "VALIDATION_FAILED" && !ERROR_DEFINITIONS[code].retryable,
)

const PublicFieldPath = z
  .string()
  .regex(/^(?!(?:__proto__|prototype|constructor)$)[\s\S]*$/u)
const hasPrototypeSensitiveFieldKey = (value: unknown): boolean => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false

  return PROTOTYPE_SENSITIVE_FIELD_KEYS.some((key) => Object.hasOwn(value, key))
}
const ValidationFields = z.preprocess((value, context) => {
  if (hasPrototypeSensitiveFieldKey(value)) {
    context.addIssue({
      code: "custom",
      message: "Prototype-sensitive validation field key",
    })
  }

  return value
}, z.record(PublicFieldPath, z.array(z.string())))

const findReservedMetadataKey = (metadataShape: MetadataShape): string | undefined => {
  return RESERVED_METADATA_KEYS.find((key) => Object.hasOwn(metadataShape, key))
}

const createEnvelopeMetaSchema = <TMetadataShape extends MetadataShape>(
  metadataShape: TMetadataShape,
) => {
  const reservedKey = findReservedMetadataKey(metadataShape)
  if (reservedKey !== undefined) {
    throw new Error(`Reserved envelope metadata key: ${reservedKey}`)
  }

  return z.strictObject({ ...BASE_METADATA_SHAPE, ...metadataShape })
}

export const EnvelopeMeta = createEnvelopeMetaSchema({})
export type EnvelopeMeta = z.infer<typeof EnvelopeMeta>

const ValidationErrorDetail = z.strictObject({
  code: z.literal("VALIDATION_FAILED"),
  message: z.string(),
  fields: ValidationFields.optional(),
  retryable: z.literal(false),
})

const RetryableErrorDetail = z.strictObject({
  code: z.enum(RETRYABLE_ERROR_CODES),
  message: z.string(),
  retryable: z.literal(true),
})

const NonValidationNonRetryableErrorDetail = z.strictObject({
  code: z.enum(NON_VALIDATION_NON_RETRYABLE_ERROR_CODES),
  message: z.string(),
  retryable: z.literal(false),
})

export const ErrorDetail = z.union([
  ValidationErrorDetail,
  RetryableErrorDetail,
  NonValidationNonRetryableErrorDetail,
])
export type ErrorDetail = z.infer<typeof ErrorDetail>

export const ErrorEnvelope = z.strictObject({
  ok: z.literal(false),
  data: z.null(),
  error: ErrorDetail,
  meta: EnvelopeMeta,
})
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>

export const createSuccessEnvelopeSchema = <
  TDataSchema extends z.ZodType,
  TMetadataShape extends MetadataShape = Record<never, never>,
>(
  dataSchema: TDataSchema,
  metadataShape?: TMetadataShape,
) => {
  const metaSchema = createEnvelopeMetaSchema(metadataShape ?? ({} as TMetadataShape))

  return z.strictObject({
    ok: z.literal(true),
    data: dataSchema,
    error: z.null(),
    meta: metaSchema,
  })
}
