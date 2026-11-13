import { useState } from "react"

import { Modal } from "~/app/overlays/Modal"
import { indiaToday } from "~/features/admin/client-values/indiaToday"
import { HeldWriteNotice } from "~/features/admin/users/HeldWriteNotice"
import { useHeldWrite } from "~/features/admin/users/useHeldWrite"
import { Button } from "~/ui/primitives/Button"
import { Alert } from "~/ui/primitives/Feedback"
import { FormField, Input } from "~/ui/primitives/FormField"
import { RadioGroup, type RadioOption } from "~/ui/primitives/Toggle"
import { STACK_LG } from "~/ui/recipes/layout"

import { FollowUpSipFields, followUpOf, type FollowUpDraft } from "./FollowUpSipFields"
import { formatMaturityDate, monthAfter } from "./maturityPresentation"
import { useResolveMaturity, type MaturityScheduleItem, type ResolveMaturityBody } from "./maturityQueries"
import {
  explanationOf,
  resolutionOutcomeText,
  type ActiveSip,
  type Choice,
  type HoldingFigures,
} from "./resolutionCopy"
import { ResolutionFacts } from "./ResolutionFacts"

export type MaturityResolveDialogProps = Readonly<{
  userId: string
  schedule: MaturityScheduleItem
  holding: HoldingFigures | null
  activeSip: ActiveSip | null | undefined
  refreshing: boolean
  onReload: () => void
  onClose: () => void
}>

const NON_NEGATIVE_PAISE = /^(0|[1-9]\d*)$/u

type BodyInput = Readonly<{
  choice: Choice
  expectedVersion: number
  effectiveDate: string
  holding: HoldingFigures | null
  sip: ReturnType<typeof followUpOf>
}>

const bodyOf = ({ choice, expectedVersion, effectiveDate, holding, sip }: BodyInput): ResolveMaturityBody | null => {
  const figuresKnown =
    holding !== null && NON_NEGATIVE_PAISE.test(holding.principalPaise) && NON_NEGATIVE_PAISE.test(holding.currentValuePaise)
  if (choice === "return_all") {
    return figuresKnown ? { resolution: choice, expectedVersion, effectiveDate, amountPaise: holding.currentValuePaise } : null
  }
  if (sip === null) return null
  if (choice === "sip_reinvestment") return { resolution: choice, expectedVersion, sip }
  if (!figuresKnown) return null
  return {
    resolution: choice,
    expectedVersion,
    effectiveDate,
    expectedPrincipalPaise: holding.principalPaise,
    expectedCurrentValuePaise: holding.currentValuePaise,
    sip,
  }
}

const laterMonth = (left: string, right: string): string => (left > right ? left : right)

export const MaturityResolveDialog = ({
  userId,
  schedule,
  holding,
  activeSip,
  refreshing,
  onReload,
  onClose,
}: MaturityResolveDialogProps): React.ReactElement => {
  const write = useHeldWrite(useResolveMaturity(userId), "The resolution could not be sent. Reload the page and try again.")
  const today = indiaToday()
  const earliestMonth = laterMonth(monthAfter(schedule.maturityDate), today.slice(0, 7))
  const canReturn = holding !== null && BigInt(holding.currentValuePaise) > 0n
  const [choice, setChoice] = useState<Choice>(canReturn ? "return_all" : "sip_reinvestment")
  const [effectiveDate, setEffectiveDate] = useState(schedule.maturityDate)
  const [draft, setDraft] = useState<FollowUpDraft>({ rupees: "", startMonth: earliestMonth, months: "12" })

  const locked = write.pending || write.outcome.kind === "unknown" || write.outcome.kind === "done"
  const needsDate = choice !== "sip_reinvestment"
  const dateValid = effectiveDate >= schedule.maturityDate && effectiveDate <= today
  const sipKnown = choice === "return_all" || activeSip !== undefined
  const body = bodyOf({
    choice,
    expectedVersion: schedule.version,
    effectiveDate,
    holding,
    sip: followUpOf(draft, earliestMonth),
  })
  const ready = body !== null && sipKnown && !refreshing && (!needsDate || dateValid)
  const changedSinceSent = write.outcome.kind === "rejected" && write.outcome.code === "STATE_CONFLICT"
  const options: readonly RadioOption<Choice>[] = [
    {
      value: "return_all",
      label: "Return all the money to the client",
      hint: canReturn ? "Withdraw the whole value and record a payout." : "Unavailable: the current value could not be read or is zero.",
      disabled: !canReturn,
    },
    {
      value: "one_time_and_sip",
      label: "One-time investment from the maturity date, then a new SIP",
      hint: "The matured value stays invested as a lump sum, and monthly payments start.",
    },
    { value: "sip_reinvestment", label: "Reinvest as a SIP", hint: "No ledger change now; monthly payments start." },
  ]

  return (
    <Modal
      open
      title={`Resolve the ${formatMaturityDate(schedule.maturityDate)} maturity`}
      description={`${schedule.fundName}. Choose what happens to this holding. Nothing changes until you confirm.`}
      onDismiss={() => {
        if (!write.pending) onClose()
      }}
      actions={
        write.outcome.kind === "done" ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button tone="secondary" disabled={write.pending} onClick={onClose}>
              Go back
            </Button>
            <Button
              disabled={locked || !ready}
              loading={write.pending}
              onClick={() => {
                if (body !== null) write.submit({ scheduleId: schedule.scheduleId, body })
              }}
            >
              Confirm resolution
            </Button>
          </>
        )
      }
    >
      {write.outcome.kind === "done" ? (
        <Alert tone="success" title="Maturity resolved">
          {resolutionOutcomeText(write.outcome.result)}
        </Alert>
      ) : (
        <div className={STACK_LG}>
          <HeldWriteNotice write={write} subject="the maturity was resolved" onReload={onReload} />
          {changedSinceSent ? (
            <Alert tone="warning" title="Review the latest figures">
              {refreshing
                ? "Reading the holding and SIP schedules again."
                : "The figures below were read again after the refusal. Check them before you confirm."}
            </Alert>
          ) : null}
          <RadioGroup<Choice>
            legend="Resolution"
            value={choice}
            options={options}
            onChange={(next) => {
              if (!locked) setChoice(next)
            }}
          />
          <ResolutionFacts choice={choice} holding={holding} activeSip={activeSip} />
          <Alert tone="info" title="What happens">
            {explanationOf(choice, holding)}
          </Alert>
          {needsDate ? (
            <FormField
              label="Settlement date"
              required
              hint="From the maturity date to today. The ledger entry, if any, carries this date."
              error={dateValid ? undefined : "Choose a date from the maturity date to today."}
            >
              {({ id }) => (
                <Input
                  id={id}
                  type="date"
                  value={effectiveDate}
                  min={schedule.maturityDate}
                  max={today}
                  disabled={locked}
                  onChange={(event) => {
                    setEffectiveDate(event.target.value)
                  }}
                />
              )}
            </FormField>
          ) : null}
          {choice === "return_all" ? null : (
            <FollowUpSipFields draft={draft} earliestMonth={earliestMonth} disabled={locked} onChange={setDraft} />
          )}
        </div>
      )}
    </Modal>
  )
}
