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
  maturedOn: "Maturity date",
  effectiveDate: "Settlement date",
  amountPaise: "Amount",
  transferReference: "Bank transfer reference",
  failureCode: "Failure code",
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

const CHECKED_LABEL = "I have checked the record"

export type HeldWriteNoticeProps = Readonly<{
  write: Pick<HeldWrite<never, unknown>, "outcome" | "pending" | "checkAgain"> &
    Partial<Pick<HeldWrite<never, unknown>, "unreadable" | "expired" | "reset">>
  subject: string
  onReload: () => void
  reloadLabel?: string
}>

type StaleProps = Readonly<{
  title: string
  reset: (() => void) | undefined
  onReload: () => void
  reloadLabel: string
  children: string
}>

const StaleHoldNotice = ({ title, reset, onReload, reloadLabel, children }: StaleProps): React.ReactElement => (
  <Alert
    tone="warning"
    title={title}
    action={
      <span className={ACTION_ROW}>
        <Button size="sm" tone="secondary" onClick={onReload}>
          {reloadLabel}
        </Button>
        {reset === undefined ? null : (
          <Button size="sm" tone="ghost" onClick={reset}>
            {CHECKED_LABEL}
          </Button>
        )}
      </span>
    }
  >
    {children}
  </Alert>
)

export const isUnsavedHold = (write: Pick<HeldWrite<object, unknown>, "held" | "persisted">): boolean =>
  write.held !== null && !write.persisted

export const UnsavedHoldNotice = ({
  write,
}: Readonly<{ write: Pick<HeldWrite<object, unknown>, "held" | "persisted"> }>): React.ReactElement | null =>
  isUnsavedHold(write) ? (
    <Alert tone="warning" title="Kept on this page only">
      This browser could not save the held request, so it lasts only while this page stays open. Stay here until it
      is confirmed.
    </Alert>
  ) : null

export const HeldWriteNotice = ({
  write,
  subject,
  onReload,
  reloadLabel = DEFAULT_RELOAD_LABEL,
}: HeldWriteNoticeProps): React.ReactElement | null => {
  const { outcome } = write
  if (write.unreadable === true && outcome.kind === "idle") {
    return (
      <StaleHoldNotice title="Held request not readable" reset={write.reset} onReload={onReload} reloadLabel={reloadLabel}>
        {`A request held in this tab could not be read back, so it is not known whether ${subject}. Check the record before entering it again.`}
      </StaleHoldNotice>
    )
  }
  if (outcome.kind === "rejected") {
    const lines = fieldLines(outcome.fields)
    return (
      <Alert tone="error" title="Nothing changed">
        {lines.length === 0 ? outcome.message : lines.join(" ")}
      </Alert>
    )
  }
  if (outcome.kind !== "unknown") return null
  if (write.expired === true) {
    return (
      <StaleHoldNotice title="No longer checkable" reset={write.reset} onReload={onReload} reloadLabel={reloadLabel}>
        {`This request has been held for more than a day, and the server keeps its answer for a day only, so Check again can no longer tell whether ${subject}. Check the record before entering it again.`}
      </StaleHoldNotice>
    )
  }
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
