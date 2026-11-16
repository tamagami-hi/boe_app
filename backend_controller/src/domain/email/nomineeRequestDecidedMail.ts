import type { Transaction, User } from "../../db/repositories.js"
import { NOMINEE_REQUEST_DECIDED_TEMPLATE_KEY, type NomineeRequestDecision } from "../../email/nomineeRequestDecidedEmail.js"
import { enqueueEmail, type EnqueueEmailDeps, type EnqueuedEmail } from "./enqueueEmail.js"

export const NOMINEE_REQUEST_DECIDED_TEMPLATE_VERSION = "v1"

export interface NomineeRequestDecidedMailDeps extends EnqueueEmailDeps {
  readonly config: Readonly<{ sesConfigurationSet: string }>
}

export interface NomineeRequestDecidedMailInput {
  readonly recipient: Pick<User, "id" | "email_normalized" | "full_name" | "email_revision">
  readonly nomineeRequestId: string
  readonly decision: NomineeRequestDecision
  readonly declineReason: string | null
  readonly requestId: string
}

export const queueNomineeRequestDecidedMail = (
  tx: Transaction,
  deps: NomineeRequestDecidedMailDeps,
  input: NomineeRequestDecidedMailInput,
): Promise<EnqueuedEmail> =>
  enqueueEmail(tx, deps, {
    recipient: input.recipient.email_normalized,
    template: { templateKey: NOMINEE_REQUEST_DECIDED_TEMPLATE_KEY, userId: input.recipient.id },
    templateVersion: NOMINEE_REQUEST_DECIDED_TEMPLATE_VERSION,
    sesConfigurationSet: deps.config.sesConfigurationSet,
    eventType: "admin.nominee_request_decided",
    eventVersion: 1,
    aggregateType: "client_nominee_request",
    aggregateId: input.nomineeRequestId,
    requestId: input.requestId,
    deduplicationKey: `${NOMINEE_REQUEST_DECIDED_TEMPLATE_KEY}:${input.nomineeRequestId}`,
    payload: {
      template: NOMINEE_REQUEST_DECIDED_TEMPLATE_KEY,
      nomineeRequestId: input.nomineeRequestId,
      decision: input.decision,
      boundEmailRevision: String(input.recipient.email_revision),
    },
    sealedPayload: {
      fullName: input.recipient.full_name,
      ...(input.declineReason === null ? {} : { declineReason: input.declineReason }),
    },
  })
