import { assertNever } from "~/lib/assertNever"
import type {
  EmailVerificationState,
  MandateState,
  SipState,
  StatusPresentation,
} from "~/domain/status"

export type ClientStatePresentation = StatusPresentation &
  Readonly<{
    detail?: string
  }>

export const clientEmailVerification = (value: EmailVerificationState): StatusPresentation => {
  switch (value) {
    case "not_started":
      return { label: "Not verified", tone: "neutral" }
    case "pending":
      return { label: "In progress", tone: "info" }
    case "verified":
      return { label: "Verified", tone: "positive" }
    default:
      return assertNever(value)
  }
}

export const clientSipStatus = (value: SipState): ClientStatePresentation => {
  switch (value) {
    case "draft":
      return { label: "Not started", tone: "neutral", detail: "This plan has not started yet." }
    case "pending_mandate":
      return {
        label: "Awaiting AutoPay",
        tone: "info",
        detail: "Authorise AutoPay to start collecting this plan.",
      }
    case "active":
      return { label: "Active", tone: "positive" }
    case "paused":
      return {
        label: "Paused",
        tone: "warning",
        detail: "No instalment is collected while this plan is paused.",
      }
    case "cancel_pending":
      return { label: "Cancelling", tone: "warning", detail: "We are cancelling this plan." }
    case "cancelled":
      return { label: "Cancelled", tone: "neutral", detail: "This plan has been cancelled." }
    case "completed":
      return { label: "Completed", tone: "positive", detail: "This plan has run its full term." }
    case "setup_failed":
      return {
        label: "AutoPay setup failed",
        tone: "negative",
        detail: "AutoPay was not set up. You can try authorising it again.",
      }
    case "mandate_failed":
      return {
        label: "AutoPay failed",
        tone: "negative",
        detail: "AutoPay was not authorised. You can try authorising it again.",
      }
    case "expired":
      return { label: "Expired", tone: "neutral", detail: "This plan is no longer running." }
    case "revoked":
      return {
        label: "Stopped",
        tone: "negative",
        detail: "AutoPay was stopped, so this plan is no longer collecting.",
      }
    default:
      return assertNever(value)
  }
}

export const clientAutoPayStatus = (value: MandateState): ClientStatePresentation => {
  switch (value) {
    case "setup_pending":
      return { label: "Not yet authorised", tone: "info" }
    case "active":
      return { label: "Active", tone: "positive" }
    case "pause_pending":
      return { label: "Pausing", tone: "warning" }
    case "paused":
      return { label: "Paused", tone: "warning" }
    case "cancel_pending":
      return {
        label: "Cancelling",
        tone: "warning",
        detail: "We have asked PhonePe to cancel this AutoPay. It shows as cancelled once confirmed.",
      }
    case "cancelled":
      return { label: "Cancelled", tone: "neutral" }
    case "revoke_pending":
      return { label: "Stopping", tone: "warning" }
    case "revoked":
      return { label: "Stopped", tone: "negative" }
    case "expired":
      return { label: "Expired", tone: "neutral" }
    case "failed":
      return { label: "Failed", tone: "negative" }
    default:
      return assertNever(value)
  }
}
