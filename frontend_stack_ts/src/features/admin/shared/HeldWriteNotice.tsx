import { Button } from "~/ui/primitives/Button"
import { Alert } from "~/ui/primitives/Feedback"
import { ACTION_ROW } from "~/ui/recipes/layout"

import type { HeldWrite } from "./useHeldWrite"

const FIELD_LABELS: Readonly<Record<string, string>> = {
  fundId: "Fund",
  monthlyAmountPaise: "Monthly amount",
  startMonth: "Start month",
  monthCount: "Months",
  state: "State",
  maturityDate: "Maturity date",
  effectiveDate: "Settlement date",
  amountPaise: "Amount",
  "sip.monthlyAmountPaise": "SIP monthly amount",
  "sip.startMonth": "First SIP month",
  "sip.monthCount": "SIP months",
  "extension.months": "Months to add",
  "extension.nextMaturityDate": "Next maturity date",
}

const fieldLines = (fields: Readonly<Record<string, readonly string[]>>): string[] =>
  Object.entries(fields).flatMap(([field, messages]) => {
    const label = FIELD_LABELS[field]
    return messages.map((message) => (label === undefined ? message : `${label} ${message}`))
  })

const DEFAULT_RELOAD_LABEL = "Reload the schedules"

export type HeldWriteNoticeProps = Readonly<{
  write: Pick<HeldWrite<never, unknown>, "outcome" | "pending" | "checkAgain">
  subject: string
  onReload: () => void
  reloadLabel?: string
}>

export const HeldWriteNotice = ({
  write,
  subject,
  onReload,
  reloadLabel = DEFAULT_RELOAD_LABEL,
}: HeldWriteNoticeProps): React.ReactElement | null => {
  const { outcome } = write
  if (outcome.kind === "rejected") {
    const lines = fieldLines(outcome.fields)
    return (
      <Alert tone="error" title="Nothing changed">
        {lines.length === 0 ? outcome.message : lines.join(" ")}
      </Alert>
    )
  }
  if (outcome.kind !== "unknown") return null
  return (
    <Alert
      tone="warning"
      title="Not confirmed"
      action={
        <span className={ACTION_ROW}>
          <Button size="sm" loading={write.pending} onClick={write.checkAgain}>
            Check again
          </Button>
          <Button size="sm" tone="ghost" disabled={write.pending} onClick={onReload}>
            {reloadLabel}
          </Button>
        </span>
      }
    >
      {`The reply did not arrive, so it is not known whether ${subject}. Check again sends the same request once more, and it can only ever apply once.`}
    </Alert>
  )
}
