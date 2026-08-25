export const PHONEPE_MIN_CHECKOUT_SECONDS = 300
export const PHONEPE_MAX_CHECKOUT_SECONDS = 3600
export const CHECKOUT_DISPATCH_BUFFER_MS = 5_000
export const MIN_PAYMENT_ATTEMPT_TTL_MS =
  PHONEPE_MIN_CHECKOUT_SECONDS * 1_000 + CHECKOUT_DISPATCH_BUFFER_MS
export const MAX_PAYMENT_ATTEMPT_TTL_MS = PHONEPE_MAX_CHECKOUT_SECONDS * 1_000

export const checkoutSecondsRemaining = (expiresAt: Date, now: Date): number | null => {
  const seconds = Math.floor((expiresAt.getTime() - now.getTime()) / 1_000)
  if (
    !Number.isSafeInteger(seconds) ||
    seconds < PHONEPE_MIN_CHECKOUT_SECONDS ||
    seconds > PHONEPE_MAX_CHECKOUT_SECONDS
  ) {
    return null
  }
  return seconds
}
