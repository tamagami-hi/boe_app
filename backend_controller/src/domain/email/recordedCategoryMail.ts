import type { Transaction } from "../../db/repositories.js"
import { ONE_TIME_INVESTMENT_TEMPLATE_KEY } from "../../email/oneTimeInvestmentTemplate.js"
import { SIP_PAYMENT_TEMPLATE_KEY } from "../../email/sipPaymentTemplate.js"
import { enqueueEmail, type EnqueuedEmail } from "./enqueueEmail.js"
import type { InvestmentRecordedMailDeps, InvestmentRecordedMailInput } from "./investmentRecordedMail.js"

export const SIP_PAYMENT_TEMPLATE_VERSION = "v1"
export const ONE_TIME_INVESTMENT_TEMPLATE_VERSION = "v1"

export type RecordedMailBase = Omit<InvestmentRecordedMailInput, "category">

export interface SipPaymentMailInput extends RecordedMailBase {
  readonly scheduleId: string
  readonly sipMonth: string
  readonly monthNumber: number
  readonly monthCount: number
  readonly nextMonth: string | null
}

const sealedOf = (input: RecordedMailBase) => ({
  fullName: input.recipient.full_name,
  fundName: input.fundName,
  amountPaise: input.amountPaise.toString(),
})

export const queueSipPaymentMail = (
  tx: Transaction,
  deps: InvestmentRecordedMailDeps,
  input: SipPaymentMailInput,
): Promise<EnqueuedEmail> =>
  enqueueEmail(tx, deps, {
    recipient: input.recipient.email_normalized,
    template: { templateKey: SIP_PAYMENT_TEMPLATE_KEY, userId: input.recipient.id },
    templateVersion: SIP_PAYMENT_TEMPLATE_VERSION,
    sesConfigurationSet: deps.config.sesConfigurationSet,
    eventType: "admin.sip_payment_recorded",
    eventVersion: 1,
    aggregateType: "client_value_entry",
    aggregateId: input.entryId,
    requestId: input.requestId,
    deduplicationKey: `${SIP_PAYMENT_TEMPLATE_KEY}:${input.entryId}`,
    payload: {
      template: SIP_PAYMENT_TEMPLATE_KEY,
      entryId: input.entryId,
      scheduleId: input.scheduleId,
      effectiveDate: input.effectiveDate,
      sipMonth: input.sipMonth,
      monthNumber: input.monthNumber,
      monthCount: input.monthCount,
      nextMonth: input.nextMonth,
      boundEmailRevision: String(input.recipient.email_revision),
    },
    sealedPayload: sealedOf(input),
  })

export const queueOneTimeInvestmentMail = (
  tx: Transaction,
  deps: InvestmentRecordedMailDeps,
  input: RecordedMailBase,
): Promise<EnqueuedEmail> =>
  enqueueEmail(tx, deps, {
    recipient: input.recipient.email_normalized,
    template: { templateKey: ONE_TIME_INVESTMENT_TEMPLATE_KEY, userId: input.recipient.id },
    templateVersion: ONE_TIME_INVESTMENT_TEMPLATE_VERSION,
    sesConfigurationSet: deps.config.sesConfigurationSet,
    eventType: "admin.one_time_investment_recorded",
    eventVersion: 1,
    aggregateType: "client_value_entry",
    aggregateId: input.entryId,
    requestId: input.requestId,
    deduplicationKey: `${ONE_TIME_INVESTMENT_TEMPLATE_KEY}:${input.entryId}`,
    payload: {
      template: ONE_TIME_INVESTMENT_TEMPLATE_KEY,
      entryId: input.entryId,
      effectiveDate: input.effectiveDate,
      boundEmailRevision: String(input.recipient.email_revision),
    },
    sealedPayload: sealedOf(input),
  })
