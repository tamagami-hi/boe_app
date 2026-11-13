import { useState } from "react"

import { Modal } from "~/app/overlays/Modal"
import { formatINR, toPaise } from "~/domain/money"
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
import { resolutionOutcomeText, type Choice, type HoldingFigures } from "./resolutionCopy"

export type ActiveSip = Readonly<{ monthlyAmountPaise: string; monthsPaid: number; monthCount: number }>

export type MaturityResolveDialogProps = Readonly<{
  userId: string
  schedule: MaturityScheduleItem
  holding: HoldingFigures | null
  activeSip: ActiveSip | null | undefined
  onReload: () => void
  onClose: () => void
}>

const money = (paise: string): string => formatINR(toPaise(paise), { showDecimals: true })

const replacedSipText = (activeSip: ActiveSip | null | undefined): string => {
  if (activeSip === undefined) {
    return "The SIP schedules could not be read just now; any active one for this fund is closed and replaced."
  }
  if (activeSip === null) return "There is no active SIP schedule for this fund."
  return `The active SIP schedule for this fund (${money(activeSip.monthlyAmountPaise)} a month, ${String(activeSip.monthsPaid)} of ${String(activeSip.monthCount)} months paid) is closed and replaced.`
}

const explanationOf = (choice: Choice, holding: HoldingFigures | null, activeSip: ActiveSip | null | undefined): string => {
  const replaced = replacedSipText(activeSip)
  if (choice === "return_all") {
    return `Records a withdrawal of the whole current value${holding === null ? "" : `, ${money(holding.currentValuePaise)}`}, and a pending payout. The app does not send money: make the bank transfer yourself, then mark the payout paid in the Maturity tab. The holding becomes zero.`
  }
  if (choice === "one_time_and_sip") {
    const figures =
      holding === null
        ? "The matured value"
        : `The matured value, ${money(holding.currentValuePaise)} against ${money(holding.principalPaise)} invested,`
    return `${figures} becomes the amount invested from the settlement date, so any gain or loss is moved into it. Nothing is paid out, and if the value already equals the amount invested no entry is written. ${replaced} A new SIP schedule starts below; nothing is collected automatically.`
  }
  return `Nothing is paid out and no ledger entry is written: the holding keeps its value and its amount invested. ${replaced} A new SIP schedule starts below. Record each month's payment when the client pays, and do not record the matured money again.`
}

const bodyOf = (
  choice: Choice,
  expectedVersion: number,
  effectiveDate: string,
  holding: HoldingFigures | null,
  sip: ReturnType<typeof followUpOf>,
): ResolveMaturityBody | null => {
  if (choice === "return_all") {
    return holding === null ? null : { resolution: choice, expectedVersion, effectiveDate, amountPaise: holding.currentValuePaise }
  }
  if (sip === null) return null
  return choice === "one_time_and_sip"
    ? { resolution: choice, expectedVersion, effectiveDate, sip }
    : { resolution: choice, expectedVersion, sip }
}

export const MaturityResolveDialog = ({
  userId,
  schedule,
  holding,
  activeSip,
  onReload,
  onClose,
}: MaturityResolveDialogProps): React.ReactElement => {
  const write = useHeldWrite(useResolveMaturity(userId), "The resolution could not be sent. Reload the page and try again.")
  const earliestMonth = monthAfter(schedule.maturityDate)
  const today = indiaToday()
  const canReturn = holding !== null && BigInt(holding.currentValuePaise) > 0n
  const [choice, setChoice] = useState<Choice>(canReturn ? "return_all" : "sip_reinvestment")
  const [effectiveDate, setEffectiveDate] = useState(schedule.maturityDate)
  const [draft, setDraft] = useState<FollowUpDraft>({ rupees: "", startMonth: earliestMonth, months: "12" })

  const locked = write.pending || write.outcome.kind === "unknown" || write.outcome.kind === "done"
  const needsDate = choice !== "sip_reinvestment"
  const dateValid = effectiveDate >= schedule.maturityDate && effectiveDate <= today
  const body = bodyOf(choice, schedule.version, effectiveDate, holding, followUpOf(draft, earliestMonth))
  const ready = body !== null && (!needsDate || dateValid)
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
          <RadioGroup<Choice>
            legend="Resolution"
            value={choice}
            options={options}
            onChange={(next) => {
              if (!locked) setChoice(next)
            }}
          />
          <Alert tone="info" title="What happens">
            {explanationOf(choice, holding, activeSip)}
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
