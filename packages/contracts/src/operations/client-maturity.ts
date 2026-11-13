import { z } from "zod"

import { createSuccessEnvelopeSchema } from "../envelope.js"
import { IsoDateTime, Uuid } from "../scalars.js"
import { MaturityOfferSip, MaturityOptionKey, MaturitySipExtension } from "./admin-maturity-schedules.js"
import { IsoDate } from "./client.js"
import { defineOperation, MAX_JSON_BODY_BYTES } from "./descriptor.js"

export const ClientMaturityOffer = z.strictObject({
  offerId: Uuid,
  fundId: Uuid,
  fundName: z.string(),
  maturityDate: IsoDate,
  state: z.string(),
  version: z.number().int().positive(),
  sentAt: IsoDateTime,
  chosenOption: z.string().nullable(),
  chosenAt: IsoDateTime.nullable(),
  sip: MaturityOfferSip,
  extension: MaturitySipExtension.nullable(),
})
export type ClientMaturityOffer = z.infer<typeof ClientMaturityOffer>

export const ClientMaturityOffersData = z.strictObject({ items: z.array(ClientMaturityOffer) })
export type ClientMaturityOffersData = z.infer<typeof ClientMaturityOffersData>

export const ClientMaturityOfferData = z.strictObject({ offer: ClientMaturityOffer })
export type ClientMaturityOfferData = z.infer<typeof ClientMaturityOfferData>

const CLIENT_READ_ERRORS = [
  "AUTHENTICATION_REQUIRED",
  "SESSION_INVALID",
  "ACCOUNT_NOT_ACTIVE",
  "CSRF_INVALID",
  "VALIDATION_FAILED",
  "INTERNAL_ERROR",
] as const

const OfferParams = z.strictObject({ offerId: Uuid })

export const listClientMaturityOffers = defineOperation({
  operationId: "listClientMaturityOffers",
  method: "GET",
  path: "/v1/client/maturity-options",
  authChannel: "native-bearer",
  credentialPolicy: "native-bearer",
  idempotency: "naturally-idempotent",
  responseCacheControl: "no-store",
  request: {},
  success: { status: 200, schema: createSuccessEnvelopeSchema(ClientMaturityOffersData) },
  errorCodes: [...CLIENT_READ_ERRORS],
})

export const getClientMaturityOffer = defineOperation({
  operationId: "getClientMaturityOffer",
  method: "GET",
  path: "/v1/client/maturity-options/{offerId}",
  authChannel: "native-bearer",
  credentialPolicy: "native-bearer",
  idempotency: "naturally-idempotent",
  responseCacheControl: "no-store",
  request: { params: OfferParams },
  success: { status: 200, schema: createSuccessEnvelopeSchema(ClientMaturityOfferData) },
  errorCodes: [...CLIENT_READ_ERRORS, "RESOURCE_NOT_FOUND"],
})

export const ChooseMaturityOptionBody = z.strictObject({
  option: MaturityOptionKey,
  expectedVersion: z.number().int().positive(),
})
export type ChooseMaturityOptionBody = z.infer<typeof ChooseMaturityOptionBody>

export const chooseClientMaturityOption = defineOperation({
  operationId: "chooseClientMaturityOption",
  method: "POST",
  path: "/v1/client/maturity-options/{offerId}/choice",
  authChannel: "native-bearer",
  credentialPolicy: "native-bearer",
  idempotency: "required-key",
  responseCacheControl: "no-store",
  request: {
    params: OfferParams,
    body: ChooseMaturityOptionBody,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 200, schema: createSuccessEnvelopeSchema(ClientMaturityOfferData) },
  errorCodes: [
    ...CLIENT_READ_ERRORS,
    "PAYLOAD_TOO_LARGE",
    "UNSUPPORTED_MEDIA_TYPE",
    "IDEMPOTENCY_KEY_REUSED",
    "IDEMPOTENCY_IN_PROGRESS",
    "RESOURCE_NOT_FOUND",
    "STATE_CONFLICT",
  ],
})

export const CLIENT_MATURITY_OPERATIONS = Object.freeze([
  listClientMaturityOffers,
  getClientMaturityOffer,
  chooseClientMaturityOption,
])
