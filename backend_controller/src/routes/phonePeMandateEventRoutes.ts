import { createHash } from "node:crypto"

import type { FastifyInstance } from "fastify"

import { encryptGcm } from "../crypto/primitives.js"
import type { UnitOfWork } from "../db/database.js"
import { reconcileMandateFact, reconcileSetupFact } from "../domain/payments/reconcileMandateFacts.js"
import { reconcileCollectionFact } from "../domain/payments/reconcileCollectionFact.js"
import { AppError } from "../http/errorCatalog.js"
import type { RecurringPaymentGateway } from "../providers/recurringPaymentGateway.js"
import { GatewayAuthenticationError, GatewayMalformedCallbackError, type PaymentGateway } from "../providers/phonepe/paymentGateway.js"
import type { MandatesRepository } from "../repositories/mandatesRepository.js"
import type { PaymentsRepository } from "../repositories/paymentsRepository.js"
import type { InvestmentSettlementRepository } from "../repositories/investmentSettlementRepository.js"
import type { ProviderEventInboxRepository } from "../repositories/providerEventInboxRepository.js"

const BODY_LIMIT = 65_536
const SETUP_EVENTS = new Set([
  "checkout.setup.order.completed",
  "checkout.setup.order.failed",
  "checkout.order.completed",
  "checkout.order.failed",
])
const COLLECTION_EVENTS = new Set([
  "subscription.notification.completed",
  "subscription.notification.failed",
  "subscription.redemption.order.completed",
  "subscription.redemption.order.failed",
  "subscription.redemption.transaction.completed",
  "subscription.redemption.transaction.failed",
])
const COLLECTION_FLOW_TYPES = new Set(["SUBSCRIPTION_CHECKOUT_REDEMPTION", "SUBSCRIPTION_REDEMPTION"])

interface ParsedMandateCallback {
  readonly event: string
  readonly providerState: string
  readonly merchantOrderId: string | null
  readonly merchantSubscriptionId: string | null
  readonly merchantId: string | null
  readonly flowType: string | null
}

export interface PhonePeMandateEventDeps {
  readonly unitOfWork: UnitOfWork
  readonly clock: () => Date
  readonly paymentGateway: PaymentGateway
  readonly recurringPaymentGateway: RecurringPaymentGateway
  readonly mandatesRepository: MandatesRepository
  readonly paymentsRepository: PaymentsRepository
  readonly settlementRepository: InvestmentSettlementRepository
  readonly providerEventInboxRepository: ProviderEventInboxRepository
  readonly config: Readonly<{
    payloadEncryptionKey: Buffer
    payloadKeyVersion: string
    merchantId: string
    eventAllowlist: readonly string[]
  }>
}

const recordOf = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null

const stringOf = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null

const parseCallback = (raw: string): ParsedMandateCallback => {
  const root = recordOf(JSON.parse(raw))
  const payload = recordOf(root?.payload)
  const paymentFlow = recordOf(payload?.paymentFlow)
  const details = recordOf(paymentFlow?.subscriptionDetails) ?? paymentFlow
  const event = stringOf(root?.event)
  const providerState = stringOf(payload?.state)
  if (event === null || providerState === null) throw new AppError("PROVIDER_CALLBACK_UNVERIFIED")
  return {
    event,
    providerState,
    merchantOrderId: stringOf(payload?.merchantOrderId),
    merchantSubscriptionId: stringOf(details?.merchantSubscriptionId) ?? stringOf(payload?.merchantSubscriptionId),
    merchantId: stringOf(payload?.merchantId),
    flowType: stringOf(paymentFlow?.type),
  }
}

const process = async (deps: PhonePeMandateEventDeps, raw: string, parsed: ParsedMandateCallback): Promise<void> => {
  const now = deps.clock()
  if (parsed.merchantId !== deps.config.merchantId) throw new AppError("PROVIDER_CALLBACK_UNVERIFIED")
  if (!deps.config.eventAllowlist.includes(parsed.event)) throw new AppError("PROVIDER_CALLBACK_UNVERIFIED")
  const reference = parsed.merchantOrderId ?? parsed.merchantSubscriptionId
  if (reference === null) throw new AppError("PROVIDER_CALLBACK_UNVERIFIED")
  if (SETUP_EVENTS.has(parsed.event) && (parsed.flowType !== "SUBSCRIPTION_CHECKOUT_SETUP" || parsed.merchantOrderId === null)) {
    throw new AppError("PROVIDER_CALLBACK_UNVERIFIED")
  }
  if (COLLECTION_EVENTS.has(parsed.event) && (
    parsed.merchantOrderId === null || parsed.merchantSubscriptionId === null ||
    parsed.flowType === null || !COLLECTION_FLOW_TYPES.has(parsed.flowType)
  )) throw new AppError("PROVIDER_CALLBACK_UNVERIFIED")
  const inserted = await deps.unitOfWork.execute(async (tx) => {
    const envelope = encryptGcm(deps.config.payloadEncryptionKey, raw)
    const payloadSha256 = createHash("sha256").update(raw).digest()
    return deps.providerEventInboxRepository.insertVerified(tx, {
      provider: "phonepe",
      eventType: `subscription.${parsed.event}`,
      dedupKey: `subscription:${parsed.event}:${reference}:${payloadSha256.toString("hex").slice(0, 32)}`,
      payloadCiphertext: envelope.ciphertext,
      payloadNonce: envelope.nonce,
      payloadKeyVersion: deps.config.payloadKeyVersion,
      payloadSha256,
      merchantOrderId: parsed.merchantOrderId,
    })
  })
  if (SETUP_EVENTS.has(parsed.event)) {
    const setup = await deps.recurringPaymentGateway.getSetupOrderStatus(parsed.merchantOrderId as string)
    await reconcileSetupFact(deps, {
      merchantOrderId: parsed.merchantOrderId as string,
      merchantSubscriptionId: parsed.merchantSubscriptionId,
      status: setup,
      now,
    })
    const mandate = await deps.recurringPaymentGateway.getMandateStatus(setup.merchantSubscriptionId)
    await reconcileMandateFact(deps, mandate, now)
  } else if (COLLECTION_EVENTS.has(parsed.event)) {
    const fact = await deps.recurringPaymentGateway.getCollectionStatus(parsed.merchantOrderId as string)
    await deps.unitOfWork.execute((tx) => reconcileCollectionFact(tx, deps, fact, now))
  } else if (parsed.merchantSubscriptionId !== null) {
    const mandate = await deps.recurringPaymentGateway.getMandateStatus(parsed.merchantSubscriptionId)
    await reconcileMandateFact(deps, mandate, now)
  } else {
    throw new AppError("PROVIDER_CALLBACK_UNVERIFIED")
  }
  await deps.unitOfWork.execute((tx) => deps.providerEventInboxRepository.markProcessed(tx, {
    eventId: inserted.eventId,
    now: deps.clock(),
  }))
}

export const registerPhonePeMandateEventRoutes = (application: FastifyInstance, deps: PhonePeMandateEventDeps): void => {
  application.register((instance, _options, done) => {
    instance.addContentTypeParser("application/json", { parseAs: "string", bodyLimit: BODY_LIMIT }, (_request, body, next) => next(null, body))
    instance.post("/v1/provider-events/phonepe/subscription", async (request, reply) => {
      if (typeof request.body !== "string" || typeof request.headers.authorization !== "string") {
        throw new AppError("PROVIDER_CALLBACK_UNVERIFIED")
      }
      try {
        deps.paymentGateway.validateShaCallback(request.headers.authorization, request.body)
      } catch (error) {
        if (error instanceof GatewayAuthenticationError || error instanceof GatewayMalformedCallbackError) {
          throw new AppError("PROVIDER_CALLBACK_UNVERIFIED")
        }
        throw new AppError("PROVIDER_CALLBACK_UNVERIFIED")
      }
      let parsed
      try {
        parsed = parseCallback(request.body)
      } catch {
        throw new AppError("PROVIDER_CALLBACK_UNVERIFIED")
      }
      if (!deps.config.eventAllowlist.includes(parsed.event)) throw new AppError("PROVIDER_CALLBACK_UNVERIFIED")
      await process(deps, request.body, parsed)
      return reply.code(200).send()
    })
    done()
  })
}
