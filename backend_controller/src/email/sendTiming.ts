import type { SmtpTimeouts } from "./emailSender.js"

export const HEARTBEAT_MAX_AGE_MS = 60_000
export const LOOP_SLEEP_MS = 15_000
export const PASS_OVERHEAD_MS = 10_000
export const EMAIL_PASS_BUDGET_MS = HEARTBEAT_MAX_AGE_MS - LOOP_SLEEP_MS - PASS_OVERHEAD_MS

const SEND_BUDGET_FLOOR_MS = 10_000
const SEND_BUDGET_CEILING_MS = 20_000
const SEND_BUDGET_LEASE_DIVISOR = 3
const POST_SEND_ALLOWANCE_MS = 5_000
const LEASE_TO_BUDGET_RATIO = 2
const DNS_SHARE_DENOMINATOR = 10
const CONNECTION_SHARE_DENOMINATOR = 5
const GREETING_SHARE_DENOMINATOR = 5

export interface EmailSendTiming {
  readonly leaseMs: number
  readonly sendBudgetMs: number
  readonly messageBudgetMs: number
  readonly smtp: SmtpTimeouts
}

export const deriveEmailSendTiming = (configuredLeaseMs: number): EmailSendTiming => {
  const sendBudgetMs = Math.min(
    SEND_BUDGET_CEILING_MS,
    Math.max(SEND_BUDGET_FLOOR_MS, Math.floor(configuredLeaseMs / SEND_BUDGET_LEASE_DIVISOR)),
  )
  const dnsTimeoutMs = Math.floor(sendBudgetMs / DNS_SHARE_DENOMINATOR)
  const connectionTimeoutMs = Math.floor(sendBudgetMs / CONNECTION_SHARE_DENOMINATOR)
  const greetingTimeoutMs = Math.floor(sendBudgetMs / GREETING_SHARE_DENOMINATOR)
  const socketTimeoutMs = sendBudgetMs - dnsTimeoutMs - connectionTimeoutMs - greetingTimeoutMs
  return {
    leaseMs: Math.max(configuredLeaseMs, LEASE_TO_BUDGET_RATIO * sendBudgetMs),
    sendBudgetMs,
    messageBudgetMs: sendBudgetMs + POST_SEND_ALLOWANCE_MS,
    smtp: { dnsTimeoutMs, connectionTimeoutMs, greetingTimeoutMs, socketTimeoutMs },
  }
}
