import { z } from "zod"

import { createSuccessEnvelopeSchema } from "../envelope.js"
import { defineOperation, MAX_JSON_BODY_BYTES } from "./descriptor.js"

export const StatementMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u)

export const StatementLinkToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/u)

export const IssueClientStatementLinkBody = z.strictObject({
  fromPeriod: StatementMonth,
  toPeriod: StatementMonth,
})
export type IssueClientStatementLinkBody = z.infer<typeof IssueClientStatementLinkBody>

export const ClientStatementLink = z.strictObject({
  token: StatementLinkToken,
})
export type ClientStatementLink = z.infer<typeof ClientStatementLink>

export const issueClientStatementLink = defineOperation({
  operationId: "issueClientStatementLink",
  method: "POST",
  path: "/v1/client/statement-links",
  authChannel: "native-bearer",
  credentialPolicy: "native-bearer",
  idempotency: "none",
  responseCacheControl: "no-store",
  request: {
    body: IssueClientStatementLinkBody,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 201, schema: createSuccessEnvelopeSchema(ClientStatementLink) },
  errorCodes: [
    "AUTHENTICATION_REQUIRED",
    "SESSION_INVALID",
    "ACCOUNT_NOT_ACTIVE",
    "CSRF_INVALID",
    "VALIDATION_FAILED",
    "PAYLOAD_TOO_LARGE",
    "UNSUPPORTED_MEDIA_TYPE",
    "RESOURCE_NOT_FOUND",
    "INTERNAL_ERROR",
  ],
})

export const openClientStatementLink = defineOperation({
  operationId: "openClientStatementLink",
  method: "GET",
  path: "/v1/public/statement-links/{token}",
  authChannel: "public-token",
  credentialPolicy: "public-path-token",
  idempotency: "single-use-token",
  responseCacheControl: "no-store",
  responseMediaType: "text/html",
  request: { params: z.strictObject({ token: StatementLinkToken }) },
  success: { status: 200, schema: z.string() },
  errorCodes: ["RESOURCE_NOT_FOUND", "INTERNAL_ERROR"],
})

export const CLIENT_STATEMENT_LINK_OPERATIONS = Object.freeze([issueClientStatementLink, openClientStatementLink])
