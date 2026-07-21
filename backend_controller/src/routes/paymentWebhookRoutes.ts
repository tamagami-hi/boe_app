/**
 * Signed payment provider webhook (spec 03 §5.2 confirm/fail). This is the
 * paid/not-paid confirmation checkpoint for a real gateway: the provider POSTs a
 * result, signed with the shared `PAYMENT_WEBHOOK_SECRET` (HMAC-SHA256 over the
 * exact raw body, hex, in `x-payment-signature`). A valid `succeeded` result
 * confirms the payment and books the order; a `failed` result fails the payment
 * and the order. Both are idempotent (a terminal order is a no-op). The route is
 * only registered when a webhook secret is configured.
 *
 * A durable financial `provider_events` inbox (dedup/replay) is the eventual
 * home for this ingress; this direct, idempotent handler is the first slice.
 */
import type { FastifyInstance, FastifyRequest } from "fastify"
import { z } from "zod"

import { bytesEqual, hmacSha256 } from "../crypto/primitives.js"
import type { UnitOfWork } from "../db/database.js"
import { recordPaymentResult, type AdvancePaymentDeps } from "../domain/client/settlePayment.js"
import { AppError } from "../http/errorCatalog.js"
import { parseOrThrow } from "../http/validation.js"

const WEBHOOK_BODY_LIMIT_BYTES = 65_536

export interface PaymentWebhookConfig {
  readonly webhookSecret: string
}

export interface PaymentWebhookDeps extends AdvancePaymentDeps {
  readonly unitOfWork: UnitOfWork
  readonly config: AdvancePaymentDeps["config"] & PaymentWebhookConfig
}

const payloadSchema = z
  .object({
    paymentId: z.string().uuid(),
    status: z.enum(["succeeded", "failed"]),
    failureCode: z.string().trim().min(1).max(100).optional(),
    providerPaymentId: z.string().trim().min(1).max(256).optional(),
  })
  .strict()

const presentedSignature = (request: FastifyRequest): Buffer | null => {
  const header = request.headers["x-payment-signature"]
  const value = Array.isArray(header) ? header[0] : header
  if (typeof value !== "string" || !/^[0-9a-f]+$/iu.test(value) || value.length % 2 !== 0) return null
  return Buffer.from(value, "hex")
}

export const registerPaymentWebhookRoutes = (application: FastifyInstance, deps: PaymentWebhookDeps): void => {
  const secretKey = Buffer.from(deps.config.webhookSecret, "utf8")

  application.register((instance, _options, done) => {
    instance.addContentTypeParser(
      "application/json",
      { parseAs: "string", bodyLimit: WEBHOOK_BODY_LIMIT_BYTES },
      (_request, body, next) => {
        next(null, body)
      },
    )

    instance.post("/v1/provider-events/payment", async (request, reply) => {
      const raw = request.body
      if (typeof raw !== "string") throw new AppError("UNSUPPORTED_MEDIA_TYPE")

      // Fail-closed signature check over the exact raw bytes.
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
        recordPaymentResult(tx, deps, {
          paymentId: body.paymentId,
          status: body.status,
          ...(body.failureCode === undefined ? {} : { failureCode: body.failureCode }),
          requestId: request.requestId,
        }),
      )
      return reply.sendData({ paymentId: body.paymentId, outcome }, { status: 200 })
    })

    done()
  })
}
