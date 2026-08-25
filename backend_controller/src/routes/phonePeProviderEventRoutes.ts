import { createHash } from "node:crypto"

import type { FastifyInstance, FastifyRequest } from "fastify"

import type { UnitOfWork } from "../db/database.js"
import type { Transaction } from "../db/repositories.js"
import { applyCanonicalPaymentOutcome } from "../domain/payments/applyCanonicalPaymentOutcome.js"
import { isRefundEvidenceCorrelated } from "../domain/payments/refundEvidence.js"
import { encryptGcm } from "../crypto/primitives.js"
import { GatewayAuthenticationError, GatewayMalformedCallbackError, type PaymentGateway, type VerifiedCallback } from "../providers/phonepe/paymentGateway.js"
import { AppError } from "../http/errorCatalog.js"
import type { PaymentsRepository } from "../repositories/paymentsRepository.js"
import type { InvestmentSettlementRepository } from "../repositories/investmentSettlementRepository.js"
import type { ProviderEventInboxRepository } from "../repositories/providerEventInboxRepository.js"
import type { RefundRepository } from "../repositories/refundRepository.js"

const PHONEPE_RAW_BODY_LIMIT_BYTES = 65_536

export interface PhonePeProviderEventConfig {
  readonly payloadEncryptionKey: Buffer
  readonly payloadKeyVersion: string
  readonly paymentEventAllowlist: readonly string[]
  readonly refundEventAllowlist: readonly string[]
}

export interface PhonePeProviderEventDeps {
  readonly unitOfWork: UnitOfWork
  readonly clock: () => Date
  readonly paymentGateway: PaymentGateway
  readonly config: PhonePeProviderEventConfig
  readonly providerEventInboxRepository: ProviderEventInboxRepository
  readonly paymentsRepository: PaymentsRepository
  readonly settlementRepository: InvestmentSettlementRepository
  readonly refundRepository: RefundRepository
}

const dedupKeyFor = (callback: VerifiedCallback): string => {
  const reference =
    callback.merchantRefundId ?? callback.merchantOrderId ?? callback.originalMerchantOrderId ?? "unknown"
  return `${callback.event}:${reference}:${callback.providerState}`
}

const merchantOrderIdOf = (callback: VerifiedCallback): string | null =>
  callback.merchantOrderId ?? callback.originalMerchantOrderId

const applyRefundOutcome = async (
  deps: PhonePeProviderEventDeps,
  tx: Transaction,
  callback: VerifiedCallback,
  now: Date,
): Promise<void> => {
  if (callback.merchantRefundId === null) return
  const refund = await deps.refundRepository.lockByMerchantRefundId(tx, callback.merchantRefundId)
  if (refund === null) return
  const originalAttempt = await deps.paymentsRepository.latestAttempt(tx, refund.payment_id)
  if (
    originalAttempt === null ||
    originalAttempt.state !== "succeeded" ||
    !isRefundEvidenceCorrelated({
      expectedAmountPaise: refund.amount_paise,
      expectedMerchantOrderId: originalAttempt.merchant_order_id,
      expectedProviderRefundId: refund.provider_refund_id,
      providerRefundId: callback.providerRefundId,
      amountPaise: callback.amountPaise,
      originalMerchantOrderId: callback.originalMerchantOrderId,
    })
  ) throw new Error("refund correlation failed")

  if (callback.outcome === "succeeded") {
    if (refund.state === "refunded") return
    const refunded = await deps.refundRepository.markRefunded(tx, {
      refundId: refund.id,
      providerRefundId: callback.providerRefundId,
      now,
    })
    if (refunded === null) throw new Error("refund success transition failed")
    const payment = await deps.paymentsRepository.markPaymentRefunded(tx, refund.payment_id, now)
    if (payment === null) throw new Error("payment refund transition failed")
    if (await deps.paymentsRepository.markOrderRefunded(tx, refund.order_id, now) === null) {
      throw new Error("order refund transition failed")
    }
    return
  }

  if (callback.outcome === "failed") {
    if (refund.state === "failed") return
    const failed = await deps.refundRepository.markFailed(tx, {
      refundId: refund.id,
      failureCode: "PROVIDER_REFUND_FAILED",
      now,
    })
    if (failed === null) throw new Error("refund failure transition failed")
    const payment = await deps.paymentsRepository.markPaymentRefundFailed(tx, refund.payment_id, now)
    if (payment === null) throw new Error("payment refund failure transition failed")
    if (await deps.paymentsRepository.markOrderRefundFailed(tx, {
      orderId: refund.order_id,
      failureCode: "PROVIDER_REFUND_FAILED",
      now,
    }) === null) throw new Error("order refund failure transition failed")
  }
}

const processCallback = async (
  deps: PhonePeProviderEventDeps,
  channel: "payment" | "refund",
  callback: VerifiedCallback,
  raw: Buffer,
  now: Date,
): Promise<void> => {
  const eventId = await deps.unitOfWork.execute(async (tx) => {
    const envelope = encryptGcm(deps.config.payloadEncryptionKey, raw)
    const inserted = await deps.providerEventInboxRepository.insertVerified(tx, {
      provider: "phonepe",
      eventType: `${channel}.${callback.event}`,
      dedupKey: dedupKeyFor(callback),
      payloadCiphertext: envelope.ciphertext,
      payloadNonce: envelope.nonce,
      payloadKeyVersion: deps.config.payloadKeyVersion,
      payloadSha256: createHash("sha256").update(raw).digest(),
      merchantOrderId: merchantOrderIdOf(callback),
    })
    const merchantOrderId = merchantOrderIdOf(callback)
    if (merchantOrderId !== null) {
      const attempt = await deps.paymentsRepository.findAttemptByMerchantOrderId(tx, merchantOrderId)
      if (attempt !== null) {
        await deps.providerEventInboxRepository.attachPayment(tx, {
          eventId: inserted.eventId,
          paymentId: attempt.payment_id,
          userId: attempt.user_id,
          now,
        })
      }
    }
    return inserted.eventId
  })

  if (channel === "payment") {
    const merchantOrderId = callback.merchantOrderId
    if (merchantOrderId === null) throw new AppError("PROVIDER_CALLBACK_UNVERIFIED")
    const fact = await deps.paymentGateway.getOrderStatus(merchantOrderId)
    await deps.unitOfWork.execute(async (tx) => {
      await applyCanonicalPaymentOutcome(tx, deps.paymentsRepository, {
        merchantOrderId,
        providerMerchantOrderId: fact.merchantOrderId,
        outcome: fact.outcome,
        providerState: fact.providerState,
        providerOrderId: fact.providerOrderId,
        amountPaise: fact.amountPaise,
        currency: fact.currency,
        details: fact.details,
      }, now, deps.settlementRepository)
      await deps.providerEventInboxRepository.markProcessed(tx, { eventId, now })
    })
    return
  }

  if (callback.merchantRefundId === null) throw new AppError("PROVIDER_CALLBACK_UNVERIFIED")
  const fact = await deps.paymentGateway.getRefundStatus(callback.merchantRefundId)
  if (fact.merchantRefundId !== callback.merchantRefundId) throw new Error("refund identity correlation failed")
  await deps.unitOfWork.execute(async (tx) => {
    await applyRefundOutcome(deps, tx, {
      ...callback,
      outcome: fact.outcome,
      providerState: fact.providerState,
      merchantRefundId: fact.merchantRefundId,
      originalMerchantOrderId: fact.originalMerchantOrderId,
      amountPaise: fact.amountPaise,
      providerRefundId: fact.providerRefundId,
    }, now)
    await deps.providerEventInboxRepository.markProcessed(tx, { eventId, now })
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
    if (!Buffer.isBuffer(raw)) throw new AppError("UNSUPPORTED_MEDIA_TYPE")

    const authorization = request.headers.authorization
    if (typeof authorization !== "string") throw new AppError("PROVIDER_CALLBACK_UNVERIFIED")

    let callback: VerifiedCallback
    try {
      callback = deps.paymentGateway.validateShaCallback(authorization, raw.toString("utf8"))
    } catch (error) {
      if (error instanceof GatewayAuthenticationError || error instanceof GatewayMalformedCallbackError) {
        throw new AppError("PROVIDER_CALLBACK_UNVERIFIED")
      }
      throw new AppError("PROVIDER_CALLBACK_UNVERIFIED")
    }

    const allowlist = channel === "payment"
      ? deps.config.paymentEventAllowlist
      : deps.config.refundEventAllowlist
    if (!allowlist.includes(callback.event)) throw new AppError("PROVIDER_CALLBACK_UNVERIFIED")

    await processCallback(deps, channel, callback, raw, deps.clock())
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
      { parseAs: "buffer", bodyLimit: PHONEPE_RAW_BODY_LIMIT_BYTES },
      (_request, body, next) => {
        next(null, body)
      },
    )

    registerChannel(instance, "/v1/provider-events/phonepe/payment", "payment", deps)
    registerChannel(instance, "/v1/provider-events/phonepe/refund", "refund", deps)

    done()
  })
}
