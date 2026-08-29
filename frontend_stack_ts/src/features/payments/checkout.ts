export const CHECKOUT_ORIGIN_ALLOWLIST: readonly string[] = [
  "https://mercury-t2.phonepe.com",
  "https://mercury-uat.phonepe.com",
  "https://mercury.phonepe.com",
  "https://api.phonepe.com",
  "https://api-preprod.phonepe.com",
]

export class CheckoutUrlRejected extends Error {
  public readonly code = "CHECKOUT_URL_REJECTED"

  public constructor(message: string) {
    super(message)
    this.name = "CheckoutUrlRejected"
  }
}

export class PendingPaymentWriteFailed extends Error {
  public readonly code = "PENDING_PAYMENT_WRITE_FAILED"

  public constructor(message: string) {
    super(message)
    this.name = "PendingPaymentWriteFailed"
  }
}

export const assertAllowedCheckoutUrl = (
  candidate: string,
  allowlist: readonly string[] = CHECKOUT_ORIGIN_ALLOWLIST,
): URL => {
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    throw new CheckoutUrlRejected("The checkout address is not a valid URL")
  }

  if (url.protocol !== "https:") {
    throw new CheckoutUrlRejected("A checkout address must use https")
  }
  if (url.username !== "" || url.password !== "") {
    throw new CheckoutUrlRejected("A checkout address must not carry credentials")
  }
  if (!allowlist.includes(url.origin)) {
    throw new CheckoutUrlRejected("The checkout address is not an approved payment origin")
  }

  return url
}

export type CheckoutDecision =
  | Readonly<{ kind: "terminal"; orderId: string; status: string }>
  | Readonly<{ kind: "poll"; paymentId: string }>
  | Readonly<{ kind: "redirect"; paymentId: string; url: string }>

export type PayOutcome = Readonly<{
  orderId: string
  status: string
  terminal?: true
  paymentId?: string
  checkout?: Readonly<{ type: "redirect"; url: string }> | null
}>

export const decideCheckout = (
  outcome: PayOutcome,
  allowlist: readonly string[] = CHECKOUT_ORIGIN_ALLOWLIST,
): CheckoutDecision => {
  if (outcome.terminal === true) {
    return { kind: "terminal", orderId: outcome.orderId, status: outcome.status }
  }

  const paymentId = outcome.paymentId
  if (paymentId === undefined) {
    throw new CheckoutUrlRejected("The payment response carried no payment identifier")
  }

  const checkout = outcome.checkout ?? null
  if (checkout === null) return { kind: "poll", paymentId }

  const url = assertAllowedCheckoutUrl(checkout.url, allowlist)
  return { kind: "redirect", paymentId, url: url.toString() }
}
