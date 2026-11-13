import type { Transaction, User } from "../../db/repositories.js"
import { enqueueEmail, type EnqueueEmailDeps, type EnqueuedEmail } from "./enqueueEmail.js"

export const INVESTMENT_RECORDED_TEMPLATE_VERSION = "v1"

export type EmailedRecordingCategory = "earlier_investment" | "monthly_investment"

export interface InvestmentRecordedMailDeps extends EnqueueEmailDeps {
  readonly config: Readonly<{ sesConfigurationSet: string }>
}

export interface InvestmentRecordedMailInput {
  readonly recipient: Pick<User, "id" | "email_normalized" | "full_name" | "email_revision">
  readonly entryId: string
  readonly fundName: string
  readonly amountPaise: bigint
  readonly effectiveDate: string
  readonly category: EmailedRecordingCategory
  readonly requestId: string
}

export const queueInvestmentRecordedMail = (
  tx: Transaction,
  deps: InvestmentRecordedMailDeps,
  input: InvestmentRecordedMailInput,
): Promise<EnqueuedEmail> =>
  enqueueEmail(tx, deps, {
    recipient: input.recipient.email_normalized,
    template: { templateKey: "investment_recorded", userId: input.recipient.id },
    templateVersion: INVESTMENT_RECORDED_TEMPLATE_VERSION,
    sesConfigurationSet: deps.config.sesConfigurationSet,
    eventType: "admin.investment_recorded",
    eventVersion: 1,
    aggregateType: "client_value_entry",
    aggregateId: input.entryId,
    requestId: input.requestId,
    deduplicationKey: `investment_recorded:${input.entryId}`,
    payload: {
      template: "investment_recorded",
      entryId: input.entryId,
      category: input.category,
      effectiveDate: input.effectiveDate,
      boundEmailRevision: String(input.recipient.email_revision),
    },
    sealedPayload: {
      fullName: input.recipient.full_name,
      fundName: input.fundName,
      amountPaise: input.amountPaise.toString(),
    },
  })
