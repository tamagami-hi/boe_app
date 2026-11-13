import type { Transaction, User } from "../../db/repositories.js"
import { enqueueEmail, type EnqueueEmailDeps, type EnqueuedEmail } from "./enqueueEmail.js"

export const MATURITY_OPTIONS_TEMPLATE_VERSION = "v1"

export interface MaturityOptionsMailDeps extends EnqueueEmailDeps {
  readonly config: Readonly<{ sesConfigurationSet: string }>
}

export interface MaturityOptionsMailInput {
  readonly recipient: Pick<User, "id" | "email_normalized" | "full_name" | "email_revision">
  readonly offerId: string
  readonly fundName: string
  readonly maturityDate: string
  readonly requestId: string
}

export const queueMaturityOptionsMail = (
  tx: Transaction,
  deps: MaturityOptionsMailDeps,
  input: MaturityOptionsMailInput,
): Promise<EnqueuedEmail> =>
  enqueueEmail(tx, deps, {
    recipient: input.recipient.email_normalized,
    template: { templateKey: "maturity_options", userId: input.recipient.id },
    templateVersion: MATURITY_OPTIONS_TEMPLATE_VERSION,
    sesConfigurationSet: deps.config.sesConfigurationSet,
    eventType: "admin.maturity_options_sent",
    eventVersion: 1,
    aggregateType: "client_maturity_offer",
    aggregateId: input.offerId,
    requestId: input.requestId,
    deduplicationKey: `maturity_options:${input.offerId}`,
    payload: {
      template: "maturity_options",
      offerId: input.offerId,
      maturityDate: input.maturityDate,
      boundEmailRevision: String(input.recipient.email_revision),
    },
    sealedPayload: {
      fullName: input.recipient.full_name,
      fundName: input.fundName,
    },
  })
