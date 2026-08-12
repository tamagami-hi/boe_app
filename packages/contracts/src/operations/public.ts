import { z } from "zod"

import { createSuccessEnvelopeSchema } from "../envelope.js"
import { VersionTag } from "../scalars.js"
import { defineOperation } from "./descriptor.js"

export { MAX_JSON_BODY_BYTES } from "./descriptor.js"

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

export const getPublicConsentDocuments = defineOperation({
  operationId: "getPublicConsentDocuments",
  method: "GET",
  path: "/v1/public/consent-documents",
  authChannel: "public",
  credentialPolicy: "none",
  idempotency: "none",
  request: {},
  success: { status: 200, schema: ConsentDocumentsSuccessEnvelope },
  errorCodes: ["RATE_LIMITED", "INTERNAL_ERROR", "DEPENDENCY_UNAVAILABLE"],
})

export const PUBLIC_OPERATIONS = Object.freeze([getPublicConsentDocuments])
