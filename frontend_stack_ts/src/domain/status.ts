import { assertNever } from "~/lib/assertNever"

export type StatusTone = "neutral" | "positive" | "negative" | "warning" | "info"

export type StatusPresentation = Readonly<{
  label: string
  tone: StatusTone
}>

export type ClientInvestmentStatus =
  | "payment_in_progress"
  | "processing"
  | "confirmed"
  | "refund_in_progress"
  | "support_required"
  | "refunded"
  | "payment_failed"

export type OrderState =
  | "submitted"
  | "payment_pending"
  | "accepted"
  | "refund_pending"
  | "refunded"
  | "refund_failed"
  | "payment_failed"
  | "cancelled"

export type PaymentState =
  | "created"
  | "provider_pending"
  | "succeeded"
  | "failed"
  | "expired"
  | "reconciliation_required"
  | "refund_pending"
  | "refunded"
  | "refund_failed"

export type SipState =
  | "draft"
  | "pending_mandate"
  | "active"
  | "paused"
  | "cancel_pending"
  | "cancelled"
  | "completed"
  | "setup_failed"
  | "mandate_failed"
  | "expired"
  | "revoked"

export type SipCollectionMode = "manual_checkout" | "phonepe_autopay"

export type MandateState =
  | "setup_pending"
  | "active"
  | "pause_pending"
  | "paused"
  | "cancel_pending"
  | "cancelled"
  | "revoke_pending"
  | "revoked"
  | "expired"
  | "failed"

export type MandateSetupState =
  | "created"
  | "dispatching"
  | "provider_pending"
  | "authorized"
  | "failed"
  | "expired"

export type RefundState = "pending" | "provider_pending" | "refunded" | "failed"

export type UserAccountState = "invited" | "active" | "suspended" | "closed"

export type ApplicationState = "submitted" | "approved" | "rejected" | "withdrawn"

export type EmailVerificationState = "not_started" | "pending" | "verified"

export type EmailDeliveryState =
  | "queued"
  | "sending"
  | "sent"
  | "delivered"
  | "retryable_failed"
  | "permanent_failed"
  | "cancelled"

export type FundState = "draft" | "published" | "paused" | "archived"

export type FundRiskLevel = "low" | "moderate" | "high" | "very_high"

export type FundReceiptAcknowledgementState = "pending" | "acknowledged"

export type SupportRequestState = "open" | "in_progress" | "resolved" | "closed"

export const clientInvestmentStatus = (value: ClientInvestmentStatus): StatusPresentation => {
  switch (value) {
    case "payment_in_progress":
      return { label: "Payment in progress", tone: "info" }
    case "processing":
      return { label: "Processing", tone: "info" }
    case "confirmed":
      return { label: "Confirmed", tone: "positive" }
    case "refund_in_progress":
      return { label: "Refund in progress", tone: "warning" }
    case "support_required":
      return { label: "Needs support", tone: "warning" }
    case "refunded":
      return { label: "Refunded", tone: "neutral" }
    case "payment_failed":
      return { label: "Payment failed", tone: "negative" }
    default:
      return assertNever(value)
  }
}

export const orderState = (value: OrderState): StatusPresentation => {
  switch (value) {
    case "submitted":
      return { label: "Submitted", tone: "info" }
    case "payment_pending":
      return { label: "Payment pending", tone: "info" }
    case "accepted":
      return { label: "Accepted", tone: "positive" }
    case "refund_pending":
      return { label: "Refund pending", tone: "warning" }
    case "refunded":
      return { label: "Refunded", tone: "neutral" }
    case "refund_failed":
      return { label: "Refund failed", tone: "negative" }
    case "payment_failed":
      return { label: "Payment failed", tone: "negative" }
    case "cancelled":
      return { label: "Cancelled", tone: "neutral" }
    default:
      return assertNever(value)
  }
}

export const paymentState = (value: PaymentState): StatusPresentation => {
  switch (value) {
    case "created":
      return { label: "Created", tone: "info" }
    case "provider_pending":
      return { label: "Awaiting provider", tone: "info" }
    case "succeeded":
      return { label: "Succeeded", tone: "positive" }
    case "failed":
      return { label: "Failed", tone: "negative" }
    case "expired":
      return { label: "Expired", tone: "neutral" }
    case "reconciliation_required":
      return { label: "Reconciliation required", tone: "warning" }
    case "refund_pending":
      return { label: "Refund pending", tone: "warning" }
    case "refunded":
      return { label: "Refunded", tone: "neutral" }
    case "refund_failed":
      return { label: "Refund failed", tone: "negative" }
    default:
      return assertNever(value)
  }
}

export const sipState = (value: SipState): StatusPresentation => {
  switch (value) {
    case "draft":
      return { label: "Draft", tone: "neutral" }
    case "pending_mandate":
      return { label: "Awaiting authorisation", tone: "info" }
    case "active":
      return { label: "Active", tone: "positive" }
    case "paused":
      return { label: "Paused", tone: "warning" }
    case "cancel_pending":
      return { label: "Cancelling", tone: "warning" }
    case "cancelled":
      return { label: "Cancelled", tone: "neutral" }
    case "completed":
      return { label: "Completed", tone: "positive" }
    case "setup_failed":
      return { label: "Setup failed", tone: "negative" }
    case "mandate_failed":
      return { label: "Authorisation failed", tone: "negative" }
    case "expired":
      return { label: "Expired", tone: "neutral" }
    case "revoked":
      return { label: "Revoked", tone: "negative" }
    default:
      return assertNever(value)
  }
}

export const sipCollectionMode = (value: SipCollectionMode): StatusPresentation => {
  switch (value) {
    case "manual_checkout":
      return { label: "Pay each installment", tone: "neutral" }
    case "phonepe_autopay":
      return { label: "AutoPay", tone: "info" }
    default:
      return assertNever(value)
  }
}

export const mandateState = (value: MandateState): StatusPresentation => {
  switch (value) {
    case "setup_pending":
      return { label: "Awaiting authorisation", tone: "info" }
    case "active":
      return { label: "Active", tone: "positive" }
    case "pause_pending":
      return { label: "Pausing", tone: "warning" }
    case "paused":
      return { label: "Paused", tone: "warning" }
    case "cancel_pending":
      return { label: "Cancelling", tone: "warning" }
    case "cancelled":
      return { label: "Cancelled", tone: "neutral" }
    case "revoke_pending":
      return { label: "Revoking", tone: "warning" }
    case "revoked":
      return { label: "Revoked", tone: "negative" }
    case "expired":
      return { label: "Expired", tone: "neutral" }
    case "failed":
      return { label: "Failed", tone: "negative" }
    default:
      return assertNever(value)
  }
}

export const mandateSetupState = (value: MandateSetupState): StatusPresentation => {
  switch (value) {
    case "created":
      return { label: "Created", tone: "info" }
    case "dispatching":
      return { label: "Dispatching", tone: "info" }
    case "provider_pending":
      return { label: "Awaiting authorisation", tone: "info" }
    case "authorized":
      return { label: "Authorised", tone: "positive" }
    case "failed":
      return { label: "Failed", tone: "negative" }
    case "expired":
      return { label: "Expired", tone: "neutral" }
    default:
      return assertNever(value)
  }
}

export const refundState = (value: RefundState): StatusPresentation => {
  switch (value) {
    case "pending":
      return { label: "Pending", tone: "warning" }
    case "provider_pending":
      return { label: "Awaiting provider", tone: "warning" }
    case "refunded":
      return { label: "Refunded", tone: "neutral" }
    case "failed":
      return { label: "Failed", tone: "negative" }
    default:
      return assertNever(value)
  }
}

export const userAccountState = (value: UserAccountState): StatusPresentation => {
  switch (value) {
    case "invited":
      return { label: "Invited", tone: "info" }
    case "active":
      return { label: "Active", tone: "positive" }
    case "suspended":
      return { label: "Suspended", tone: "warning" }
    case "closed":
      return { label: "Closed", tone: "negative" }
    default:
      return assertNever(value)
  }
}

export const applicationState = (value: ApplicationState): StatusPresentation => {
  switch (value) {
    case "submitted":
      return { label: "Awaiting review", tone: "info" }
    case "approved":
      return { label: "Approved", tone: "positive" }
    case "rejected":
      return { label: "Rejected", tone: "negative" }
    case "withdrawn":
      return { label: "Withdrawn", tone: "neutral" }
    default:
      return assertNever(value)
  }
}

export const emailVerificationState = (value: EmailVerificationState): StatusPresentation => {
  switch (value) {
    case "not_started":
      return { label: "Not started", tone: "neutral" }
    case "pending":
      return { label: "Pending", tone: "info" }
    case "verified":
      return { label: "Verified", tone: "positive" }
    default:
      return assertNever(value)
  }
}

export const emailDeliveryState = (value: EmailDeliveryState): StatusPresentation => {
  switch (value) {
    case "queued":
      return { label: "Queued", tone: "info" }
    case "sending":
      return { label: "Sending", tone: "info" }
    case "sent":
      return { label: "Sent", tone: "positive" }
    case "delivered":
      return { label: "Delivered", tone: "positive" }
    case "retryable_failed":
      return { label: "Retrying", tone: "warning" }
    case "permanent_failed":
      return { label: "Failed", tone: "negative" }
    case "cancelled":
      return { label: "Cancelled", tone: "neutral" }
    default:
      return assertNever(value)
  }
}

export const fundState = (value: FundState): StatusPresentation => {
  switch (value) {
    case "draft":
      return { label: "Draft", tone: "neutral" }
    case "published":
      return { label: "Published", tone: "positive" }
    case "paused":
      return { label: "Paused", tone: "warning" }
    case "archived":
      return { label: "Archived", tone: "neutral" }
    default:
      return assertNever(value)
  }
}

export const fundRiskLevel = (value: FundRiskLevel): StatusPresentation => {
  switch (value) {
    case "low":
      return { label: "Low risk", tone: "positive" }
    case "moderate":
      return { label: "Moderate risk", tone: "info" }
    case "high":
      return { label: "High risk", tone: "warning" }
    case "very_high":
      return { label: "Very high risk", tone: "negative" }
    default:
      return assertNever(value)
  }
}

export const fundReceiptAcknowledgementState = (
  value: FundReceiptAcknowledgementState,
): StatusPresentation => {
  switch (value) {
    case "pending":
      return { label: "Awaiting acknowledgement", tone: "warning" }
    case "acknowledged":
      return { label: "Acknowledged", tone: "positive" }
    default:
      return assertNever(value)
  }
}

export const supportRequestState = (value: SupportRequestState): StatusPresentation => {
  switch (value) {
    case "open":
      return { label: "Open", tone: "info" }
    case "in_progress":
      return { label: "In progress", tone: "info" }
    case "resolved":
      return { label: "Resolved", tone: "positive" }
    case "closed":
      return { label: "Closed", tone: "neutral" }
    default:
      return assertNever(value)
  }
}
