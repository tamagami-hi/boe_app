import { randomUUID } from "node:crypto"

const REFERENCE_PATTERN = /^[A-Za-z0-9_-]+$/u
const MAX_REFERENCE_LENGTH = 63

const newMerchantReference = (service: string | null, kind: "order" | "subscription" | "refund"): string => {
  if (service !== "boe-dev" && service !== "boe-prod") throw new Error("A configured payment service identity is required")
  return `${service}_${kind}_${randomUUID().replaceAll("-", "")}`
}

export const newMerchantOrderId = (service: string | null): string => newMerchantReference(service, "order")

export const newMerchantSubscriptionId = (service: string | null): string => newMerchantReference(service, "subscription")

export const newMerchantRefundId = (service: string | null): string => newMerchantReference(service, "refund")

export const isValidMerchantReference = (value: string): boolean =>
  value.length > 0 && value.length <= MAX_REFERENCE_LENGTH && REFERENCE_PATTERN.test(value)
