import { z } from "zod"

import { createSuccessEnvelopeSchema } from "../envelope.js"
import { defineOperation } from "./descriptor.js"

export const HealthData = z.strictObject({ status: z.literal("ok") })
export type HealthData = z.infer<typeof HealthData>

export const HealthSuccessEnvelope = createSuccessEnvelopeSchema(HealthData)
export type HealthSuccessEnvelope = z.infer<typeof HealthSuccessEnvelope>

export const getHealth = defineOperation({
  operationId: "getHealth",
  method: "GET",
  path: "/v1/health",
  authChannel: "public",
  credentialPolicy: "none",
  idempotency: "none",
  request: {},
  success: { status: 200, schema: HealthSuccessEnvelope },
  errorCodes: ["INTERNAL_ERROR"],
})

export const OPS_OPERATIONS = Object.freeze([getHealth])
