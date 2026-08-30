import { createHash, timingSafeEqual } from "node:crypto"

import {
  GatewayAuthenticationError,
  GatewayMalformedCallbackError,
  type ProviderOutcome,
  type ProviderPaymentDetailFact,
  type VerifiedCallback,
} from "../paymentGateway.js"

const MAX_SPLIT_INSTRUMENTS = 16
const MAX_PROVIDER_EVIDENCE_LENGTH = 256

const paiseFromNumber = (amount: unknown): string | null => {
  if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0) return null
  return String(amount)
}

const mapOutcome = (providerState: string): ProviderOutcome => {
  if (providerState === "COMPLETED") return "succeeded"
  if (providerState === "FAILED") return "failed"
  return "pending"
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const optionalString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null

const evidenceString = (value: unknown): string | null => {
  if (typeof value !== "string") return null
  const normalized = value.trim()
  if (
    normalized.length === 0 ||
    normalized.length > MAX_PROVIDER_EVIDENCE_LENGTH ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) return null
  return normalized
}

const uniqueEvidence = (values: readonly unknown[]): readonly string[] =>
  [...new Set(values.map(evidenceString).filter((value): value is string => value !== null))]

const verifyCallbackAuthorization = (username: string, password: string, authorization: string): boolean => {
  const expected = createHash("sha256").update(`${username}:${password}`).digest()
  if (!/^[0-9a-fA-F]{64}$/u.test(authorization)) return false
  const supplied = Buffer.from(authorization, "hex")
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}

const mapPaymentDetails = (value: unknown): readonly ProviderPaymentDetailFact[] => {
  if (!Array.isArray(value)) return []
  const facts: ProviderPaymentDetailFact[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const transactionId = evidenceString(entry.transactionId)
    if (transactionId === null) continue
    const rawSplitInstruments = entry.splitInstruments
    if (
      rawSplitInstruments !== undefined &&
      (!Array.isArray(rawSplitInstruments) ||
        rawSplitInstruments.length > MAX_SPLIT_INSTRUMENTS ||
        !rawSplitInstruments.every(isRecord))
    ) continue
    const splitInstruments = Array.isArray(rawSplitInstruments) ? rawSplitInstruments : []
    const rootRail = isRecord(entry.rail) ? entry.rail : null
    const splitRails = splitInstruments
      .map((splitInstrument) => splitInstrument.rail)
      .filter(isRecord)
    const splitInstrumentTypes = splitInstruments
      .map((splitInstrument) => splitInstrument.instrument)
      .filter(isRecord)
      .map((instrument) => instrument.type)
    const utrs = uniqueEvidence([
      rootRail?.utr,
      ...splitRails.map((rail) => rail.utr),
    ])
    const instrumentTypes = uniqueEvidence(splitInstrumentTypes)
    facts.push({
      transactionId,
      reference: utrs.length === 1
        ? utrs[0]!
        : utrs.length === 0
          ? evidenceString(entry.referenceId)
          : null,
      instrumentType: instrumentTypes.length === 1 ? instrumentTypes[0]! : evidenceString(entry.paymentMode),
      state: evidenceString(entry.state),
      amountPaise: paiseFromNumber(entry.amount),
    })
  }
  return facts
}

export interface PhonePeCallbackVerifierConfig {
  readonly callbackUsername: string
  readonly callbackPassword: string
}

export interface PaymentCallbackVerifier {
  readonly validateShaCallback: (authorizationHeader: string, rawBody: string) => VerifiedCallback
}

export const createPhonePeCallbackVerifier = (
  config: PhonePeCallbackVerifierConfig,
): PaymentCallbackVerifier => ({
  validateShaCallback: (authorizationHeader: string, rawBody: string): VerifiedCallback => {
    if (!verifyCallbackAuthorization(config.callbackUsername, config.callbackPassword, authorizationHeader)) {
      throw new GatewayAuthenticationError("callback authorization failed")
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(rawBody)
    } catch (error) {
      throw new GatewayMalformedCallbackError("callback body is not JSON", { cause: error })
    }
    if (!isRecord(parsed)) throw new GatewayMalformedCallbackError("callback body is not an object")

    const event = optionalString(parsed.event)
    const payload = isRecord(parsed.payload) ? parsed.payload : null
    const providerState = payload === null ? null : optionalString(payload.state)
    if (event === null || payload === null || providerState === null) {
      throw new GatewayMalformedCallbackError("callback is missing event or payload.state")
    }

    return {
      event,
      outcome: mapOutcome(providerState),
      providerState,
      merchantOrderId: optionalString(payload.merchantOrderId),
      merchantRefundId: optionalString(payload.merchantRefundId),
      originalMerchantOrderId: optionalString(payload.originalMerchantOrderId),
      providerOrderId: optionalString(payload.orderId),
      providerRefundId: optionalString(payload.refundId),
      amountPaise: paiseFromNumber(payload.amount),
      details: mapPaymentDetails(payload.paymentDetails),
    }
  },
})
