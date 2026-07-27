/**
 * Signed mandate provider webhook (spec 03 §5.2 activateMandate / failMandate).
 * The mandate authorization confirmation checkpoint: when the user authorizes
 * (or declines) the debit mandate at the bank/UPI, the provider POSTs a signed
 * result. `authorized` activates the mandate and its waiting SIPs; `failed`
 * revokes it. Same shared-secret HMAC scheme and env-gating as the payment
 * webhook. Only registered when a webhook secret is configured.
 */
import type { FastifyInstance, FastifyRequest } from "fastify"
import { z } from "zod"

import { bytesEqual, hmacSha256 } from "../crypto/primitives.js"
import type { UnitOfWork } from "../db/database.js"
import { recordMandateResult, type ActivateMandateDeps } from "../domain/client/activateMandate.js"
import { AppError } from "../http/errorCatalog.js"
import { parseOrThrow } from "../http/validation.js"

const WEBHOOK_BODY_LIMIT_BYTES = 65_536

export interface MandateWebhookDeps extends ActivateMandateDeps {
  readonly unitOfWork: UnitOfWork
  readonly config: { readonly webhookSecret: string }
}

const payloadSchema = z
  .object({
    mandateId: z.string().uuid(),
    status: z.enum(["authorized", "failed"]),
    providerMandateId: z.string().trim().min(1).max(256).optional(),
  })
  .strict()

const presentedSignature = (request: FastifyRequest): Buffer | null => {
  const header = request.headers["x-mandate-signature"]
  const value = Array.isArray(header) ? header[0] : header
  if (typeof value !== "string" || !/^[0-9a-f]+$/iu.test(value) || value.length % 2 !== 0) return null
  return Buffer.from(value, "hex")
}

export const registerMandateWebhookRoutes = (application: FastifyInstance, deps: MandateWebhookDeps): void => {
  const secretKey = Buffer.from(deps.config.webhookSecret, "utf8")

  application.register((instance, _options, done) => {
    instance.addContentTypeParser(
      "application/json",
      { parseAs: "string", bodyLimit: WEBHOOK_BODY_LIMIT_BYTES },
      (_request, body, next) => {
        next(null, body)
      },
    )

    instance.post("/v1/provider-events/mandate", async (request, reply) => {
      const raw = request.body
      if (typeof raw !== "string") throw new AppError("UNSUPPORTED_MEDIA_TYPE")

      const presented = presentedSignature(request)
      if (presented === null || !bytesEqual(hmacSha256(secretKey, raw), presented)) {
        throw new AppError("AUTHENTICATION_REQUIRED")
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        throw new AppError("VALIDATION_FAILED")
      }
      const body = parseOrThrow(payloadSchema, parsed)

      const outcome = await deps.unitOfWork.execute((tx) =>
        recordMandateResult(tx, deps, {
          mandateId: body.mandateId,
          status: body.status,
          ...(body.providerMandateId === undefined ? {} : { providerMandateId: body.providerMandateId }),
          requestId: request.requestId,
        }),
      )
      return reply.sendData({ mandateId: body.mandateId, outcome }, { status: 200 })
    })

    done()
  })
}
