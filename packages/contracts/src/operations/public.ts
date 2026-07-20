import { z } from "zod"

import { createSuccessEnvelopeSchema } from "../envelope.js"
import type { ErrorCode } from "../errors.js"
import {
  EmailInput,
  FullName,
  IdempotencyKey,
  PhoneInput,
  VersionTag,
} from "../scalars.js"

export const MAX_JSON_BODY_BYTES = 65_536

export const ConsentKind = z.enum(["terms", "privacy"])
export type ConsentKind = z.infer<typeof ConsentKind>

export const PublicPath = z
  .string()
  .regex(
    /^(?!\/\/)(?!.*\/\.{1,2}(?:\/|$))(?!.*%(?:25|2F|5C|2E))\/(?:[A-Za-z0-9._~!$&'()*+,;=:@\/-]|%[0-9A-F]{2})*$/u,
  )
export type PublicPath = z.infer<typeof PublicPath>

const createConsentDocumentSchema = <TKind extends ConsentKind>(kind: TKind) =>
  z.strictObject({
    kind: z.literal(kind),
    version: VersionTag,
    publicPath: PublicPath,
    contentMarkdown: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  })

const createExactPairSchema = <TFirst extends z.ZodType, TSecond extends z.ZodType>(
  first: TFirst,
  second: TSecond,
) => z.tuple([first, second], z.never()).meta({ minItems: 2, maxItems: 2 })

const TermsConsentDocument = createConsentDocumentSchema("terms")
const PrivacyConsentDocument = createConsentDocumentSchema("privacy")

export const ConsentDocument = z.union([TermsConsentDocument, PrivacyConsentDocument])
export type ConsentDocument = z.infer<typeof ConsentDocument>

const ConsentDocumentPair = z.union([
  createExactPairSchema(TermsConsentDocument, PrivacyConsentDocument),
  createExactPairSchema(PrivacyConsentDocument, TermsConsentDocument),
])

export const ConsentDocumentsData = z.strictObject({ items: ConsentDocumentPair })
export type ConsentDocumentsData = z.infer<typeof ConsentDocumentsData>

export const ConsentDocumentsSuccessEnvelope = createSuccessEnvelopeSchema(ConsentDocumentsData)
export type ConsentDocumentsSuccessEnvelope = z.infer<typeof ConsentDocumentsSuccessEnvelope>

const createConsentEvidenceSchema = <TKind extends ConsentKind>(kind: TKind) =>
  z.strictObject({
    kind: z.literal(kind),
    version: VersionTag,
    accepted: z.literal(true),
  })

const TermsConsentEvidence = createConsentEvidenceSchema("terms")
const PrivacyConsentEvidence = createConsentEvidenceSchema("privacy")
const ApplicationConsentPair = z.union([
  createExactPairSchema(TermsConsentEvidence, PrivacyConsentEvidence),
  createExactPairSchema(PrivacyConsentEvidence, TermsConsentEvidence),
])

export const SubmitApplicationBody = z.strictObject({
  fullName: FullName,
  email: EmailInput,
  phone: PhoneInput,
  consents: ApplicationConsentPair,
})
export type SubmitApplicationBody = z.infer<typeof SubmitApplicationBody>

export const SubmitApplicationHeaders = z.strictObject({
  "idempotency-key": IdempotencyKey,
})
export type SubmitApplicationHeaders = z.infer<typeof SubmitApplicationHeaders>

export const SubmitApplicationData = z.strictObject({ accepted: z.literal(true) })
export type SubmitApplicationData = z.infer<typeof SubmitApplicationData>

export const SubmitApplicationSuccessEnvelope = createSuccessEnvelopeSchema(SubmitApplicationData)
export type SubmitApplicationSuccessEnvelope = z.infer<typeof SubmitApplicationSuccessEnvelope>

export const VerifyApplicationEmailBody = z.strictObject({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
})
export type VerifyApplicationEmailBody = z.infer<typeof VerifyApplicationEmailBody>

export const VerifyApplicationEmailData = z.strictObject({ verified: z.literal(true) })
export type VerifyApplicationEmailData = z.infer<typeof VerifyApplicationEmailData>

export const VerifyApplicationEmailSuccessEnvelope = createSuccessEnvelopeSchema(
  VerifyApplicationEmailData,
)
export type VerifyApplicationEmailSuccessEnvelope = z.infer<
  typeof VerifyApplicationEmailSuccessEnvelope
>

type PublicOperationInput = Readonly<{
  operationId: string
  method: "GET" | "POST"
  path: string
  authChannel: "public" | "public-token"
  idempotency: "none" | "required" | "single-use-token"
  request: Readonly<{
    body?: z.ZodType
    headers?: z.ZodType
    mediaType?: "application/json"
    maxBodyBytes?: number
  }>
  success: Readonly<{ status: 200 | 202; schema: z.ZodType }>
  errorCodes: readonly ErrorCode[]
}>

type FrozenPublicOperation<TOperation extends PublicOperationInput> = Readonly<
  Omit<TOperation, "request" | "success" | "errorCodes"> & {
    request: Readonly<TOperation["request"]>
    success: Readonly<TOperation["success"]>
    errorCodes: Readonly<TOperation["errorCodes"]>
  }
>

const definePublicOperation = <const TOperation extends PublicOperationInput>(
  operation: TOperation,
) => {
  const frozenOperation = Object.freeze({
    ...operation,
    request: Object.freeze({ ...operation.request }),
    success: Object.freeze({ ...operation.success }),
    errorCodes: Object.freeze([...operation.errorCodes]),
  })

  return frozenOperation as FrozenPublicOperation<TOperation>
}

export const getPublicConsentDocuments = definePublicOperation({
  operationId: "getPublicConsentDocuments",
  method: "GET",
  path: "/v1/public/consent-documents",
  authChannel: "public",
  idempotency: "none",
  request: {},
  success: { status: 200, schema: ConsentDocumentsSuccessEnvelope },
  errorCodes: ["RATE_LIMITED", "INTERNAL_ERROR", "DEPENDENCY_UNAVAILABLE"],
})

export const submitApplication = definePublicOperation({
  operationId: "submitApplication",
  method: "POST",
  path: "/v1/applications",
  authChannel: "public",
  idempotency: "required",
  request: {
    body: SubmitApplicationBody,
    headers: SubmitApplicationHeaders,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 202, schema: SubmitApplicationSuccessEnvelope },
  errorCodes: [
    "VALIDATION_FAILED",
    "STATE_CONFLICT",
    "IDEMPOTENCY_KEY_REUSED",
    "IDEMPOTENCY_IN_PROGRESS",
    "PAYLOAD_TOO_LARGE",
    "UNSUPPORTED_MEDIA_TYPE",
    "RATE_LIMITED",
    "INTERNAL_ERROR",
    "DEPENDENCY_UNAVAILABLE",
  ],
})

export const verifyApplicationEmail = definePublicOperation({
  operationId: "verifyApplicationEmail",
  method: "POST",
  path: "/v1/applications/verify-email",
  authChannel: "public-token",
  idempotency: "single-use-token",
  request: {
    body: VerifyApplicationEmailBody,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 200, schema: VerifyApplicationEmailSuccessEnvelope },
  errorCodes: [
    "VALIDATION_FAILED",
    "TOKEN_INVALID",
    "TOKEN_ALREADY_USED",
    "TOKEN_EXPIRED",
    "PAYLOAD_TOO_LARGE",
    "UNSUPPORTED_MEDIA_TYPE",
    "RATE_LIMITED",
    "INTERNAL_ERROR",
    "DEPENDENCY_UNAVAILABLE",
  ],
})

export const PUBLIC_OPERATIONS = Object.freeze([
  getPublicConsentDocuments,
  submitApplication,
  verifyApplicationEmail,
])
