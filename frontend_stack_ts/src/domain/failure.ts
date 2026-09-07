import type { ErrorCode } from "@beonedge/contracts"

import { isApiError, isRetryable, isTransportError } from "~/api/errors"
import type { TransportErrorKind } from "~/api/errors"

export type ClientFailure = Readonly<{
  title: string
  message: string
  retryable: boolean
}>

export type FailureContext =
  | "signIn"
  | "sendVerificationCode"
  | "checkVerificationCode"
  | "createInvestmentOrder"
  | "payInvestmentOrder"
  | "createSip"
  | "authoriseAutoPay"
  | "changeSipPlan"
  | "cancelAutoPay"
  | "sendSupportRequest"
  | "markNotificationRead"
  | "openLink"
  | "generic"

type Copy = Readonly<{ title?: string; message: string }>

type ContextRules = Readonly<{
  title: string
  codes?: Readonly<Partial<Record<ErrorCode, Copy>>>
  transport?: Readonly<Partial<Record<TransportErrorKind, Copy>>>
  fallback: Copy
}>

const GENERIC_TITLE = "That did not work"

const GENERIC_MESSAGE = "We couldn't complete this action right now. Please try again."

const TRANSPORT_BASE: Readonly<Record<TransportErrorKind, Copy>> = {
  offline: {
    title: "No connection",
    message: "We can't reach BeOnEdge. Check your connection and try again.",
  },
  timeout: {
    title: "That took too long",
    message: "The request didn't finish in time. Please try again.",
  },
  malformed: { message: GENERIC_MESSAGE },
}

const CODE_BASE: Readonly<Partial<Record<ErrorCode, Copy>>> = {
  VALIDATION_FAILED: {
    title: "Check the details",
    message: "Some of the details need checking. Review them and try again.",
  },
  CURSOR_INVALID: { message: "This list needs reloading. Please try again." },
  TOKEN_INVALID: { message: "That code is not correct. Check it and try again." },
  TOKEN_EXPIRED: { message: "That code has expired. Ask for a new one." },
  TOKEN_ALREADY_USED: { message: "That code has already been used. Ask for a new one." },
  AUTHENTICATION_REQUIRED: { message: "Please sign in again to continue." },
  SESSION_INVALID: { message: "Please sign in again to continue." },
  INVALID_CREDENTIALS: { message: "That email and password combination is not correct." },
  AUTHORIZATION_DENIED: { message: "This account can't do that." },
  ACCOUNT_NOT_ACTIVE: { message: "This account is not active. Contact support to continue." },
  CSRF_INVALID: { message: "Your session needs refreshing. Please try again." },
  RESOURCE_NOT_FOUND: { message: "We couldn't find that." },
  STATE_CONFLICT: { message: "This has already moved on. Refresh to see its current status." },
  IDEMPOTENCY_KEY_REUSED: { message: "This has already been submitted. Give it a moment." },
  IDEMPOTENCY_IN_PROGRESS: { message: "This is already being processed. Give it a moment." },
  PAYLOAD_TOO_LARGE: { message: "That is too long to send. Shorten it and try again." },
  RATE_LIMITED: { message: "Too many attempts just now. Wait a moment and try again." },
  INTERNAL_ERROR: { message: "Something went wrong on our side. Please try again in a moment." },
  DEPENDENCY_UNAVAILABLE: { message: "This is temporarily unavailable. Please try again shortly." },
}

const UNCONFIRMED_MONEY_SAFE =
  "We couldn't confirm this. No payment has been taken — check Activity before trying again."

const CONTEXTS: Readonly<Record<FailureContext, ContextRules>> = {
  signIn: {
    title: "Sign-in failed",
    codes: {
      VALIDATION_FAILED: { message: "Enter your email address and password." },
      DEPENDENCY_UNAVAILABLE: { message: "Sign-in is temporarily unavailable. Try again shortly." },
    },
    transport: {
      offline: { message: "We can't reach BeOnEdge. Check your connection and try again." },
      timeout: { message: "That took too long. Nothing was changed — try again." },
    },
    fallback: { message: "We couldn't sign you in. Please try again." },
  },

  sendVerificationCode: {
    title: "We couldn't send the code",
    codes: {
      RATE_LIMITED: { message: "A code was sent recently. You can ask for another shortly." },
      DEPENDENCY_UNAVAILABLE: { message: "We couldn't send the email just now. Try again shortly." },
      STATE_CONFLICT: { message: "This email address is already verified." },
    },
    fallback: { message: "We couldn't send the code. Please try again." },
  },

  checkVerificationCode: {
    title: "That code didn't work",
    codes: {
      STATE_CONFLICT: { message: "That code is no longer valid. Ask for a new one." },
      RATE_LIMITED: { message: "Too many attempts on that code. Ask for a new one." },
    },
    fallback: { message: "We couldn't check that code. Please try again." },
  },

  createInvestmentOrder: {
    title: "Investment not started",
    codes: {
      STATE_CONFLICT: { message: "This fund can't take an investment right now." },
      VALIDATION_FAILED: { message: "Check the amount and try again." },
      DEPENDENCY_UNAVAILABLE: {
        message: "Investing is temporarily unavailable. No payment has been taken.",
      },
    },
    transport: { offline: { message: UNCONFIRMED_MONEY_SAFE }, timeout: { message: UNCONFIRMED_MONEY_SAFE } },
    fallback: { message: "We couldn't start this investment. No payment has been taken." },
  },

  payInvestmentOrder: {
    title: "Payment not started",
    codes: {
      DEPENDENCY_UNAVAILABLE: {
        message: "Payments are temporarily unavailable. Your investment is saved — open it from Activity to pay.",
      },
      STATE_CONFLICT: {
        message: "This investment can no longer be paid. Open it from Activity to see its status.",
      },
    },
    transport: { offline: { message: UNCONFIRMED_MONEY_SAFE }, timeout: { message: UNCONFIRMED_MONEY_SAFE } },
    fallback: { message: "We couldn't start the payment. No payment has been taken." },
  },

  createSip: {
    title: "SIP not created",
    codes: {
      STATE_CONFLICT: { message: "This fund can't take a SIP right now." },
      VALIDATION_FAILED: { message: "Check the amount and schedule, then try again." },
      DEPENDENCY_UNAVAILABLE: { message: "SIPs are temporarily unavailable. Nothing was created." },
    },
    transport: {
      offline: { message: "We couldn't confirm this. Check SIP plans before trying again." },
      timeout: { message: "We couldn't confirm this. Check SIP plans before trying again." },
    },
    fallback: { message: "We couldn't create this SIP." },
  },

  authoriseAutoPay: {
    title: "AutoPay not authorised",
    codes: {
      DEPENDENCY_UNAVAILABLE: {
        message:
          "AutoPay isn't available right now. Your SIP is saved and waiting for authorisation, and you can pay each instalment manually in the meantime.",
      },
      STATE_CONFLICT: {
        message: "We couldn't start this authorisation. Check SIP plans — the plan may already be waiting there.",
      },
    },
    transport: {
      offline: { message: "We couldn't confirm this. No AutoPay was authorised. Check SIP plans before trying again." },
      timeout: { message: "We couldn't confirm this. No AutoPay was authorised. Check SIP plans before trying again." },
    },
    fallback: { message: "We couldn't set up AutoPay. No payment has been taken." },
  },

  changeSipPlan: {
    title: "Nothing changed",
    codes: {
      STATE_CONFLICT: { message: "This plan has already changed. Refresh to see its current status." },
      DEPENDENCY_UNAVAILABLE: { message: "This isn't available right now. Nothing changed." },
    },
    fallback: { message: "We couldn't update this plan. Nothing changed." },
  },

  cancelAutoPay: {
    title: "AutoPay not cancelled",
    codes: {
      STATE_CONFLICT: { message: "This AutoPay has already changed. Refresh to see its current status." },
      DEPENDENCY_UNAVAILABLE: { message: "AutoPay isn't available right now. Nothing changed." },
    },
    fallback: { message: "We couldn't cancel AutoPay. Nothing changed." },
  },

  sendSupportRequest: {
    title: "Not sent",
    codes: {
      VALIDATION_FAILED: { message: "Check the subject and description, then try again." },
      RATE_LIMITED: { message: "You've sent several requests just now. Wait a moment and try again." },
    },
    fallback: { message: "We couldn't send your request. Nothing was sent — please try again." },
  },

  markNotificationRead: {
    title: "Not updated",
    fallback: { message: "We couldn't mark this as read. Please try again." },
  },

  openLink: {
    title: "Couldn't open that",
    fallback: { message: "We couldn't open that link on this device." },
  },

  generic: {
    title: GENERIC_TITLE,
    fallback: { message: GENERIC_MESSAGE },
  },
}

export const PAYMENT_LINK_REJECTED: ClientFailure = {
  title: "Payment not started",
  message:
    "We couldn't open a secure payment page, so we stopped. No payment has been taken. Please try again, or contact support if it keeps happening.",
  retryable: true,
}

export const PAYMENT_NOT_RECORDED: ClientFailure = {
  title: "Payment not started",
  message:
    "This device couldn't save the payment details, so we stopped before opening the payment page. No payment has been taken. Please try again.",
  retryable: true,
}

export const AUTOPAY_NOT_RECORDED: ClientFailure = {
  title: "AutoPay not authorised",
  message:
    "This device couldn't save the authorisation details, so we stopped. No AutoPay was authorised and no payment has been taken. Your SIP is saved under SIP plans.",
  retryable: true,
}

export const describeClientFailure = (error: unknown, context: FailureContext): ClientFailure => {
  const rules = CONTEXTS[context]
  const retryable = isRetryable(error)

  if (isTransportError(error)) {
    const copy = rules.transport?.[error.kind] ?? TRANSPORT_BASE[error.kind]
    return { title: copy.title ?? rules.title, message: copy.message, retryable }
  }

  if (isApiError(error)) {
    const copy = rules.codes?.[error.code] ?? CODE_BASE[error.code] ?? rules.fallback
    return { title: copy.title ?? rules.title, message: copy.message, retryable }
  }

  return { title: rules.fallback.title ?? rules.title, message: rules.fallback.message, retryable }
}

export const failureDiagnostics = (error: unknown): string => {
  if (isApiError(error)) {
    return `${error.code} ${String(error.status)}${error.requestId === null ? "" : ` req=${error.requestId}`}`
  }
  if (isTransportError(error)) return `transport:${error.kind}`
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return "unknown"
}
