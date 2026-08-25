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
  accepted: "confirmed",
  refund_pending: "refund_in_progress",
  refund_failed: "support_required",
  refunded: "refunded",
  payment_failed: "payment_failed",
  cancelled: "payment_failed",
}

const PAYMENT_STATUS: Readonly<Record<PaymentState, ClientInvestmentStatus>> = {
  created: "payment_in_progress",
  provider_pending: "payment_in_progress",
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
