const REASONS: Readonly<Record<string, string>> = {
  PROVIDER_DECLINED: "Declined by the payment partner",
  PROVIDER_REJECTED: "Declined by the payment partner",
  PROVIDER_REFUSED: "Declined by the payment partner",
  MANDATE_INACTIVE: "AutoPay was not active",
  EXPIRED: "The payment window closed",
  COLLECTION_EXPIRED: "The payment window closed",
  SETUP_ABANDONED: "The authorisation was not completed",
  PROVIDER_REFUND_FAILED: "The refund could not be completed",
  PROVIDER_REFUND_ID_MISMATCH: "The refund needs checking by our team",
  PAYMENT_GATEWAY_NOT_CONFIGURED: "Payments are not available at the moment",
  STATUS_UNAVAILABLE: "The payment partner did not respond",
}

export const paymentFailureReason = (code: string | null | undefined): string | null => {
  if (typeof code !== "string") return null
  const trimmed = code.trim().toUpperCase()
  if (trimmed === "") return null
  return REASONS[trimmed] ?? null
}
