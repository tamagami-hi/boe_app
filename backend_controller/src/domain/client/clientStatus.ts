/**
 * Client-safe investment status projection (spec §9.2). Client responses never
 * expose the raw internal order/payment state enums; both collapse onto this
 * single vocabulary so the app has one set of statuses to render.
 */
import type { OrderState, PaymentState } from "../../db/types.js"

export type ClientInvestmentStatus =
  | "payment_in_progress"
  | "processing"
  | "confirmed"
  | "refund_in_progress"
  | "support_required"
  | "refunded"
  | "payment_failed"

const ORDER_STATUS: Readonly<Record<OrderState, ClientInvestmentStatus>> = {
  submitted: "payment_in_progress",
  payment_pending: "payment_in_progress",
  review_pending: "processing",
  accepted: "confirmed",
  refund_pending: "refund_in_progress",
  refund_failed: "support_required",
  refunded: "refunded",
  payment_failed: "payment_failed",
  // A cancelled order never took money; from the client's side it is a payment
  // that did not complete.
  cancelled: "payment_failed",
}

const PAYMENT_STATUS: Readonly<Record<PaymentState, ClientInvestmentStatus>> = {
  created: "payment_in_progress",
  provider_pending: "payment_in_progress",
  // A succeeded payment still awaits review before the investment is confirmed.
  succeeded: "processing",
  failed: "payment_failed",
  expired: "payment_failed",
  reconciliation_required: "support_required",
  refund_pending: "refund_in_progress",
  refund_failed: "support_required",
  refunded: "refunded",
}

export const projectOrderStatus = (state: OrderState): ClientInvestmentStatus => ORDER_STATUS[state]
export const projectPaymentStatus = (
  state: PaymentState,
  orderState?: OrderState,
): ClientInvestmentStatus =>
  state === "succeeded" && orderState === "accepted" ? "confirmed" : PAYMENT_STATUS[state]
