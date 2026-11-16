import type { Transaction, User } from "../../db/repositories.js"
import { SIP_EARLY_EXIT_TEMPLATE_KEY } from "../../email/earlyExitTemplate.js"
import { enqueueEmail, type EnqueueEmailDeps, type EnqueuedEmail } from "./enqueueEmail.js"

export const SIP_EARLY_EXIT_TEMPLATE_VERSION = "v1"

export interface SipEarlyExitMailDeps extends EnqueueEmailDeps {
  readonly config: Readonly<{ sesConfigurationSet: string }>
}

export interface SipEarlyExitMailInput {
  readonly recipient: Pick<User, "id" | "email_normalized" | "full_name" | "email_revision">
  readonly earlyExitId: string
  readonly fundName: string
  readonly amountPaise: string
  readonly effectiveDate: string
  readonly requestId: string
}

export const queueSipEarlyExitMail = (
  tx: Transaction,
  deps: SipEarlyExitMailDeps,
  input: SipEarlyExitMailInput,
): Promise<EnqueuedEmail> =>
  enqueueEmail(tx, deps, {
    recipient: input.recipient.email_normalized,
    template: { templateKey: SIP_EARLY_EXIT_TEMPLATE_KEY, userId: input.recipient.id },
    templateVersion: SIP_EARLY_EXIT_TEMPLATE_VERSION,
    sesConfigurationSet: deps.config.sesConfigurationSet,
    eventType: "admin.sip_early_exit",
    eventVersion: 1,
    aggregateType: "sip_early_exit",
    aggregateId: input.earlyExitId,
    requestId: input.requestId,
    deduplicationKey: `${SIP_EARLY_EXIT_TEMPLATE_KEY}:${input.earlyExitId}`,
    payload: {
      template: SIP_EARLY_EXIT_TEMPLATE_KEY,
      earlyExitId: input.earlyExitId,
      effectiveDate: input.effectiveDate,
      boundEmailRevision: String(input.recipient.email_revision),
    },
    sealedPayload: {
      fullName: input.recipient.full_name,
      fundName: input.fundName,
      amountPaise: input.amountPaise,
    },
  })
