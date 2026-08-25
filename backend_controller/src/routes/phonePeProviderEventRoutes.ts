import { createHash } from "node:crypto"

import type { FastifyInstance, FastifyRequest } from "fastify"

import type { UnitOfWork } from "../db/database.js"
import type { Transaction } from "../db/repositories.js"
import { applyCanonicalPaymentOutcome } from "../domain/payments/applyCanonicalPaymentOutcome.js"
import { encryptGcm } from "../crypto/primitives.js"
import { GatewayAuthenticationError, GatewayMalformedCallbackError, type PaymentGateway, type VerifiedCallback } from "../providers/phonepe/paymentGateway.js"
import { AppError } from "../http/errorCatalog.js"
import type { PaymentsRepository } from "../repositories/paymentsRepository.js"
import type { ProviderEventInboxRepository } from "../repositories/providerEventInboxRepository.js"
import type { RefundRepository } from "../repositories/refundRepository.js"

const PHONEPE_RAW_BODY_LIMIT_BYTES = 65_536

export interface PhonePeProviderEventConfig {
  readonly payloadEncryptionKey: Buffer
  readonly payloadKeyVersion: string
}

export interface PhonePeProviderEventDeps {
  readonly unitOfWork: UnitOfWork
  readonly clock: () => Date
  readonly paymentGateway: PaymentGateway
  readonly config: PhonePeProviderEventConfig
  readonly providerEventInboxRepository: ProviderEventInboxRepository
  readonly paymentsRepository: PaymentsRepository
  readonly refundRepository: RefundRepository
}

const dedupKeyFor = (callback: VerifiedCallback): string => {
  const reference =
    callback.merchantRefundId ?? callback.merchantOrderId ?? callback.originalMerchantOrderId ?? "unknown"
  return `${callback.event}:${reference}:${callback.providerState}`
}

const merchantOrderIdOf = (callback: VerifiedCallback): string | null =>
  callback.merchantOrderId ?? callback.originalMerchantOrderId

const applyPaymentOutcome = async (
  deps: PhonePeProviderEventDeps,
  tx: Transaction,
  callback: VerifiedCallback,
  now: Date,
): Promise<void> => {
  const merchantOrderId = merchantOrderIdOf(callback)
  if (merchantOrderId === null) return
  await applyCanonicalPaymentOutcome(tx, deps.paymentsRepository, {
    merchantOrderId,
    outcome: callback.outcome,
    providerState: callback.providerState,
    providerOrderId: callback.providerOrderId,
    details: callback.details,
  }, now)
}

const applyRefundOutcome = async (
  deps: PhonePeProviderEventDeps,
  tx: Transaction,
  callback: VerifiedCallback,
  now: Date,
): Promise<void> => {
  if (callback.merchantRefundId === null) return
  const refund = await deps.refundRepository.lockByMerchantRefundId(tx, callback.merchantRefundId)
  if (refund === null) return

  if (callback.outcome === "succeeded") {
    const refunded = await deps.refundRepository.markRefunded(tx, {
      refundId: refund.id,
      providerRefundId: callback.providerRefundId,
      now,
    })
    if (refunded === null) return
    const payment = await deps.paymentsRepository.markPaymentRefunded(tx, refund.payment_id, now)
    if (payment === null) return
    await deps.paymentsRepository.markOrderRefunded(tx, refund.order_id, now)
    return
  }

  if (callback.outcome === "failed") {
    const failed = await deps.refundRepository.markFailed(tx, {
      refundId: refund.id,
      failureCode: "PROVIDER_REFUND_FAILED",
      now,
    })
    if (failed === null) return
    const payment = await deps.paymentsRepository.markPaymentRefundFailed(tx, refund.payment_id, now)
    if (payment === null) return
    await deps.paymentsRepository.markOrderRefundFailed(tx, {
      orderId: refund.order_id,
      failureCode: "PROVIDER_REFUND_FAILED",
      now,
    })
  }
}

const processCallback = async (
  deps: PhonePeProviderEventDeps,
  channel: "payment" | "refund",
  callback: VerifiedCallback,
  now: Date,
): Promise<void> => {
  await deps.unitOfWork.execute(async (tx) => {
    const envelope = encryptGcm(deps.config.payloadEncryptionKey, JSON.stringify(callback))
    const inserted = await deps.providerEventInboxRepository.insertVerified(tx, {
      provider: "phonepe",
      eventType: `${channel}.${callback.event}`,
      dedupKey: dedupKeyFor(callback),
      payloadCiphertext: envelope.ciphertext,
      payloadNonce: envelope.nonce,
      payloadKeyVersion: deps.config.payloadKeyVersion,
      payloadSha256: createHash("sha256").update(JSON.stringify(callback)).digest(),
      merchantOrderId: merchantOrderIdOf(callback),
    })
    if (inserted.isDuplicate) return

    if (channel === "refund") {
      await applyRefundOutcome(deps, tx, callback, now)
    } else {
      await applyPaymentOutcome(deps, tx, callback, now)
    }

    await deps.providerEventInboxRepository.markProcessed(tx, { eventId: inserted.eventId, now })
  })
}

const registerChannel = (
  instance: FastifyInstance,
  path: string,
  channel: "payment" | "refund",
  deps: PhonePeProviderEventDeps,
): void => {
  instance.post(path, async (request: FastifyRequest, reply) => {
    const raw = request.body
    if (typeof raw !== "string") throw new AppError("UNSUPPORTED_MEDIA_TYPE")

    const authorization = request.headers.authorization
    if (typeof authorization !== "string") throw new AppError("PROVIDER_CALLBACK_UNVERIFIED")

    let callback: VerifiedCallback
    try {
      callback = deps.paymentGateway.validateShaCallback(authorization, raw)
    } catch (error) {
      if (error instanceof GatewayAuthenticationError || error instanceof GatewayMalformedCallbackError) {
        throw new AppError("PROVIDER_CALLBACK_UNVERIFIED")
      }
      throw new AppError("PROVIDER_CALLBACK_UNVERIFIED")
    }

    await processCallback(deps, channel, callback, deps.clock())
    return reply.code(200).send()
  })
}

export const registerPhonePeProviderEventRoutes = (
  application: FastifyInstance,
  deps: PhonePeProviderEventDeps,
): void => {
  application.register((instance, _options, done) => {
    instance.addContentTypeParser(
      "application/json",
      { parseAs: "string", bodyLimit: PHONEPE_RAW_BODY_LIMIT_BYTES },
      (_request, body, next) => {
        next(null, body)
      },
    )

    registerChannel(instance, "/v1/provider-events/phonepe/payment", "payment", deps)
    registerChannel(instance, "/v1/provider-events/phonepe/refund", "refund", deps)

    done()
  })
}
