import type { Transaction } from "../../db/repositories.js"
import { INVESTMENT_GROWTH_TEMPLATE_KEY } from "../../email/investmentGrowthTemplate.js"
import { AppError } from "../../http/errorCatalog.js"
import type {
  ClientGrowthMailRepository,
  GrowthMailRecipient,
} from "../../repositories/clientGrowthMailRepository.js"
import { enqueueEmail, type EnqueueEmailDeps } from "./enqueueEmail.js"

export const INVESTMENT_GROWTH_TEMPLATE_VERSION = "v1"

export interface InvestmentGrowthMailDeps extends EnqueueEmailDeps {
  readonly clientGrowthMailRepository: ClientGrowthMailRepository
  readonly config: Readonly<{ sesConfigurationSet: string }>
}

export interface WrittenGrowthEntry {
  readonly userId: string
  readonly deltaPaise: bigint
}

export interface InvestmentGrowthMailInput {
  readonly batchId: string
  readonly fundId: string
  readonly effectiveDate: string
  readonly requestId: string
  readonly entries: readonly WrittenGrowthEntry[]
}

interface RecipientMail {
  readonly recipient: GrowthMailRecipient
  readonly fundName: string
  readonly deltaPaise: bigint
  readonly valueAfterPaise: bigint
}

const canReceiveMail = (recipient: GrowthMailRecipient): boolean =>
  recipient.account_state === "active" && recipient.pii_tombstoned_at === null

const queueOne = (
  tx: Transaction,
  deps: InvestmentGrowthMailDeps,
  input: InvestmentGrowthMailInput,
  mail: RecipientMail,
) =>
  enqueueEmail(tx, deps, {
    recipient: mail.recipient.email_normalized,
    template: { templateKey: INVESTMENT_GROWTH_TEMPLATE_KEY, userId: mail.recipient.id },
    templateVersion: INVESTMENT_GROWTH_TEMPLATE_VERSION,
    sesConfigurationSet: deps.config.sesConfigurationSet,
    eventType: "admin.investment_growth",
    eventVersion: 1,
    aggregateType: "client_growth_batch",
    aggregateId: input.batchId,
    requestId: input.requestId,
    deduplicationKey: `${INVESTMENT_GROWTH_TEMPLATE_KEY}:${input.batchId}:${mail.recipient.id}`,
    payload: {
      template: INVESTMENT_GROWTH_TEMPLATE_KEY,
      batchId: input.batchId,
      fundId: input.fundId,
      effectiveDate: input.effectiveDate,
      boundEmailRevision: String(mail.recipient.email_revision),
    },
    sealedPayload: {
      fullName: mail.recipient.full_name,
      fundName: mail.fundName,
      deltaPaise: mail.deltaPaise.toString(),
      valueAfterPaise: mail.valueAfterPaise.toString(),
    },
  })

export const queueInvestmentGrowthMail = async (
  tx: Transaction,
  deps: InvestmentGrowthMailDeps,
  input: InvestmentGrowthMailInput,
): Promise<void> => {
  const deltas = new Map(input.entries.map((entry) => [entry.userId, entry.deltaPaise]))
  if (deltas.size !== input.entries.length) throw new AppError("INTERNAL_ERROR")
  const recipients = (await deps.clientGrowthMailRepository.listRecipients(tx, [...deltas.keys()])).filter(canReceiveMail)
  if (recipients.length === 0) return
  const fundName = await deps.clientGrowthMailRepository.findFundName(tx, input.fundId)
  if (fundName === null) throw new AppError("INTERNAL_ERROR")
  const values = await deps.clientGrowthMailRepository.listValues(tx, input.fundId, recipients.map((recipient) => recipient.id))
  for (const recipient of recipients) {
    const deltaPaise = deltas.get(recipient.id)
    const valueAfterPaise = values.get(recipient.id)
    if (deltaPaise === undefined || valueAfterPaise === undefined) throw new AppError("INTERNAL_ERROR")
    await queueOne(tx, deps, input, { recipient, fundName, deltaPaise, valueAfterPaise })
  }
}
