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
  | "startAutoPay"
  | "authoriseAutoPay"
  | "changeSipPlan"
  | "cancelAutoPay"
  | "requestPasswordReset"
  | "resetPassword"
  | "changePassword"
  | "changePhone"
  | "sendNomineeRequest"
  | "withdrawNomineeRequest"
  | "requestEmailChange"
  | "confirmEmailChange"
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

const TOO_MANY_REQUESTS: Copy = { message: "Too many requests right now. Try again in a few minutes." }

const UNCONFIRMED_MONEY_SAFE =
  "We couldn't confirm this. No payment has been taken — check Activity before trying again."

const ONLINE_PAYMENT_UNAVAILABLE_TITLE = "Online payment is not available"

const AUTOPAY_UNAVAILABLE_TITLE = "AutoPay is not available"

const RECORDED_INVESTMENTS_STILL_SHOW =
  "Investments recorded by the BeOnEdge team still appear in your portfolio."

const AUTOPAY_UNCONFIRMED =
  "We couldn't confirm this. No AutoPay was authorised. Check SIP plans before trying again."

const AUTOPAY_TRANSPORT: Readonly<Partial<Record<TransportErrorKind, Copy>>> = {
  offline: { message: AUTOPAY_UNCONFIRMED },
  timeout: { message: AUTOPAY_UNCONFIRMED },
}

const AUTOPAY_STATE_CONFLICT: Copy = {
  message: "We couldn't start this authorisation. Check SIP plans — the plan may already be waiting there.",
}

const AUTOPAY_FALLBACK: Copy = { message: "We couldn't set up AutoPay. No payment has been taken." }

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
      RATE_LIMITED: TOO_MANY_REQUESTS,
      DEPENDENCY_UNAVAILABLE: { message: "We couldn't send the email just now. Try again shortly." },
      STATE_CONFLICT: { message: "This email address is already verified." },
    },
    fallback: { message: "We couldn't send the code. Please try again." },
  },

  checkVerificationCode: {
    title: "That code didn't work",
    codes: {
      STATE_CONFLICT: { message: "That code is no longer valid. Ask for a new one." },
      RATE_LIMITED: TOO_MANY_REQUESTS,
    },
    fallback: { message: "We couldn't check that code. Please try again." },
  },

  createInvestmentOrder: {
    title: "Investment not started",
    codes: {
      STATE_CONFLICT: { message: "This fund can't take an investment right now." },
      VALIDATION_FAILED: { message: "Check the amount and try again." },
      DEPENDENCY_UNAVAILABLE: {
        title: ONLINE_PAYMENT_UNAVAILABLE_TITLE,
        message: `Online payment is not available in the app right now, so nothing was charged or saved. ${RECORDED_INVESTMENTS_STILL_SHOW}`,
      },
    },
    transport: { offline: { message: UNCONFIRMED_MONEY_SAFE }, timeout: { message: UNCONFIRMED_MONEY_SAFE } },
    fallback: { message: "We couldn't start this investment. No payment has been taken." },
  },

  payInvestmentOrder: {
    title: "Payment not started",
    codes: {
      DEPENDENCY_UNAVAILABLE: {
        title: ONLINE_PAYMENT_UNAVAILABLE_TITLE,
        message: `Online payment is not available in the app right now, so nothing was charged. This investment request stays in Activity. ${RECORDED_INVESTMENTS_STILL_SHOW}`,
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
      DEPENDENCY_UNAVAILABLE: {
        title: ONLINE_PAYMENT_UNAVAILABLE_TITLE,
        message: `Online payment is not available in the app right now, so this SIP was not created and nothing was charged or saved. ${RECORDED_INVESTMENTS_STILL_SHOW}`,
      },
    },
    transport: {
      offline: { message: "We couldn't confirm this. Check SIP plans before trying again." },
      timeout: { message: "We couldn't confirm this. Check SIP plans before trying again." },
    },
    fallback: { message: "We couldn't create this SIP." },
  },

  startAutoPay: {
    title: "AutoPay not authorised",
    codes: {
      DEPENDENCY_UNAVAILABLE: {
        title: AUTOPAY_UNAVAILABLE_TITLE,
        message: `AutoPay is not available in the app right now, so it was not set up and nothing was charged or saved. ${RECORDED_INVESTMENTS_STILL_SHOW}`,
      },
      STATE_CONFLICT: AUTOPAY_STATE_CONFLICT,
    },
    transport: AUTOPAY_TRANSPORT,
    fallback: AUTOPAY_FALLBACK,
  },

  authoriseAutoPay: {
    title: "AutoPay not authorised",
    codes: {
      DEPENDENCY_UNAVAILABLE: {
        title: AUTOPAY_UNAVAILABLE_TITLE,
        message: `AutoPay is not available in the app right now, so nothing was authorised or charged, and this SIP stays as it is. ${RECORDED_INVESTMENTS_STILL_SHOW}`,
      },
      STATE_CONFLICT: AUTOPAY_STATE_CONFLICT,
    },
    transport: AUTOPAY_TRANSPORT,
    fallback: AUTOPAY_FALLBACK,
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

  requestPasswordReset: {
    title: "We couldn't send that",
    codes: {
      VALIDATION_FAILED: { message: "Enter the email address on your account." },
      RATE_LIMITED: TOO_MANY_REQUESTS,
      DEPENDENCY_UNAVAILABLE: { message: "We couldn't send the email just now. Try again shortly." },
    },
    transport: {
      offline: { message: "We can't reach BeOnEdge. Check your connection and try again." },
      timeout: { message: "That took too long. Try again." },
    },
    fallback: { message: "We couldn't send a reset link. Please try again." },
  },

  resetPassword: {
    title: "That didn't work",
    codes: {
      INVALID_CREDENTIALS: {
        message: "This link is no longer valid. Ask for a new one and use the newest email.",
      },
      VALIDATION_FAILED: { message: "Use at least 12 characters." },
      RATE_LIMITED: TOO_MANY_REQUESTS,
    },
    transport: {
      offline: { message: "We can't reach BeOnEdge. Check your connection and try again." },
      timeout: { message: "That took too long. Your password may not have changed — try signing in." },
    },
    fallback: { message: "We couldn't set that password. Please try again." },
  },

  changePassword: {
    title: "Password not changed",
    codes: {
      INVALID_CREDENTIALS: { message: "That current password is not right." },
      VALIDATION_FAILED: { message: "Use at least 12 characters for the new password." },
      RATE_LIMITED: TOO_MANY_REQUESTS,
    },
    transport: {
      offline: { message: "We can't reach BeOnEdge. Check your connection and try again." },
      timeout: { message: "That took too long. Nothing was changed — try again." },
    },
    fallback: { message: "We couldn't change your password. Please try again." },
  },

  changePhone: {
    title: "Phone number not changed",
    codes: {
      INVALID_CREDENTIALS: { message: "That current password is not right." },
      VALIDATION_FAILED: { message: "Enter the number with its country code, for example +919876543210." },
      STATE_CONFLICT: { message: "That number is already used by another account or a pending application." },
      RATE_LIMITED: TOO_MANY_REQUESTS,
    },
    transport: {
      offline: { message: "We can't reach BeOnEdge. Check your connection and try again." },
      timeout: {
        title: "Not confirmed",
        message: "The reply did not arrive, so we can't tell whether your number changed. Reload this page to see the number on your account.",
      },
    },
    fallback: { message: "We couldn't change your phone number. Please try again." },
  },

  sendNomineeRequest: {
    title: "Request not sent",
    codes: {
      INVALID_CREDENTIALS: { message: "That current password is not right." },
      RATE_LIMITED: TOO_MANY_REQUESTS,
      VALIDATION_FAILED: { message: "Check the nominee's name and their relation to you, then try again." },
      ACCOUNT_NOT_ACTIVE: { message: "This account is not active, so it cannot send a nominee request. Contact support." },
      STATE_CONFLICT: { message: "A nominee request is already waiting for the BeOnEdge team. Reload to see it." },
    },
    fallback: { message: "We couldn't send your request. Please try again." },
  },

  withdrawNomineeRequest: {
    title: "Request not withdrawn",
    codes: {
      STATE_CONFLICT: { message: "This request has already been decided or changed. Reload to see where it stands." },
      RESOURCE_NOT_FOUND: { message: "We couldn't find this request. Reload to see your nominee requests." },
    },
    fallback: { message: "We couldn't withdraw your request. Please try again." },
  },

  requestEmailChange: {
    title: "Code not sent",
    codes: {
      INVALID_CREDENTIALS: { message: "That current password is not right." },
      VALIDATION_FAILED: { message: "Enter a full email address, like name@example.com." },
      STATE_CONFLICT: { message: "That email address is already used by another account or a pending application." },
      RATE_LIMITED: TOO_MANY_REQUESTS,
    },
    transport: {
      offline: { message: "We can't reach BeOnEdge. Check your connection and try again." },
      timeout: {
        title: "Not confirmed",
        message: "The reply did not arrive. Check the new inbox for a code, or reload this page to see whether a code is waiting.",
      },
    },
    fallback: { message: "We couldn't send a code. Please try again." },
  },

  confirmEmailChange: {
    title: "Email not changed",
    codes: {
      TOKEN_INVALID: { message: "That code is not right. Check the letters and their case, and try again." },
      TOKEN_EXPIRED: { message: "That code has expired. Ask for a new one." },
      STATE_CONFLICT: { message: "This change can no longer be confirmed. Ask for a new code." },
      VALIDATION_FAILED: { message: "Enter the 6-character code from the email." },
    },
    transport: {
      offline: { message: "We can't reach BeOnEdge. Check your connection and try again." },
      timeout: {
        title: "Not confirmed",
        message: "The reply did not arrive, so we can't tell whether your email changed. Sign in with the new address; if that is refused, sign in with your old one.",
      },
    },
    fallback: { message: "We couldn't confirm the change. Please try again." },
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
