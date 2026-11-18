import { hasCode, isApiError, isTemporaryFailure, isTransportError } from "~/api/errors"
import type { HeldWriteOutcome } from "~/features/admin/shared/useHeldWrite"

const SECONDS_PER_MINUTE = 60

const CONFIRMATION_CODES = ["TOKEN_INVALID", "TOKEN_EXPIRED", "TOKEN_ALREADY_USED"] as const

export const CONFIRMATION_REFUSED =
  "Your password confirmation could not be used, because it expired, was already used, or belongs to another session. Nothing was published. Review and publish again, and enter your password."

export const VALIDATION_REFUSED =
  "That configuration was refused. Check the fields marked above and the Advanced JSON, then publish again."

const waitText = (retryAfterSeconds: number | null): string => {
  if (retryAfterSeconds === null) return "a few minutes"
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / SECONDS_PER_MINUTE))
  return minutes === 1 ? "a minute" : `${String(minutes)} minutes`
}

export const describeConfirmFailure = (error: unknown): string => {
  if (hasCode(error, "INVALID_CREDENTIALS")) return "That password is not right."
  if (isApiError(error) && error.code === "RATE_LIMITED") {
    return `Too many tries. Wait ${waitText(error.retryAfterSeconds)}, then try again.`
  }
  if (hasCode(error, "AUTHORIZATION_DENIED")) return "Your role cannot publish configuration."
  if (hasCode(error, "AUTHENTICATION_REQUIRED", "SESSION_INVALID")) return "Your session ended. Sign in again to publish."
  if (isTransportError(error) || isTemporaryFailure(error)) {
    return "Your password could not be checked. Check the connection and try again."
  }
  return isApiError(error) ? error.message : "Your password could not be checked. Try again."
}

export type PublishRefusal = Readonly<{ kind: "conflict" }> | Readonly<{ kind: "message"; text: string }>

export const describePublishRefusal = (outcome: HeldWriteOutcome<unknown>): PublishRefusal | null => {
  if (outcome.kind !== "rejected") return null
  if (outcome.code === "STATE_CONFLICT") return { kind: "conflict" }
  if (CONFIRMATION_CODES.some((code) => code === outcome.code)) return { kind: "message", text: CONFIRMATION_REFUSED }
  if (outcome.code === "VALIDATION_FAILED") return { kind: "message", text: VALIDATION_REFUSED }
  return { kind: "message", text: outcome.message }
}
