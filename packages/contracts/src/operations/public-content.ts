import { z } from "zod"

import { createSuccessEnvelopeSchema } from "../envelope.js"
import { IsoDateTime } from "../scalars.js"
import { defineOperation } from "./descriptor.js"

export const LegalDocumentData = z.looseObject({
  title: z.string(),
  version: z.number().int(),
  updatedAt: IsoDateTime.nullable(),
})
export type LegalDocumentData = z.infer<typeof LegalDocumentData>

const legalDocument = (operationId: string, path: string) =>
  defineOperation({
    operationId,
    method: "GET",
    path,
    authChannel: "public",
    credentialPolicy: "none",
    idempotency: "none",
    request: {},
    success: { status: 200, schema: createSuccessEnvelopeSchema(LegalDocumentData) },
    errorCodes: ["RESOURCE_NOT_FOUND", "INTERNAL_ERROR", "DEPENDENCY_UNAVAILABLE"],
  })

export const getPublicDisclosures = legalDocument("getPublicDisclosures", "/v1/public/disclosures")
export const getPublicInvestorCharter = legalDocument(
  "getPublicInvestorCharter",
  "/v1/public/investor-charter",
)
export const getPublicGrievance = legalDocument("getPublicGrievance", "/v1/public/grievance")

export const PUBLIC_CONTENT_OPERATIONS = Object.freeze([
  getPublicDisclosures,
  getPublicInvestorCharter,
  getPublicGrievance,
])
