import { useState } from "react"

import { Modal } from "~/app/overlays/Modal"
import { formatYearMonth, indiaToday } from "~/domain/dates"
import { HeldWriteNotice } from "~/features/admin/shared/HeldWriteNotice"
import { useHeldWrite } from "~/features/admin/shared/useHeldWrite"
import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { Button } from "~/ui/primitives/Button"
import { Alert } from "~/ui/primitives/Feedback"
import { FormField, Input } from "~/ui/primitives/FormField"
import { STACK_LG } from "~/ui/recipes/layout"

import { OPTION_LABELS, formatMaturityDate } from "./maturityPresentation"
import {
  useConfirmMaturityOffer,
  type ConfirmMaturityOfferBody,
  type MaturityOfferSummary,
  type MaturityScheduleItem,
} from "./maturityQueries"
import { ActiveSipFacts, HoldingFacts } from "./ResolutionFacts"
import {
  explanationOf,
  figuresOf,
  money,
  resolutionOutcomeText,
  type ActiveSip,
  type Choice,
  factsReloadOf,
  type ReadsReload,
  type HoldingFigures,
  type HoldingRead,
} from "./resolutionCopy"

export type MaturityConfirmDialogProps = Readonly<{
  userId: string
  schedule: MaturityScheduleItem
  offer: MaturityOfferSummary
  holding: HoldingRead
  activeSip: ActiveSip | null | undefined
  reload: ReadsReload
  onClose: () => void
}>

const NON_NEGATIVE_PAISE = /^(0|[1-9]\d*)$/u
const CHOICES: ReadonlySet<string> = new Set(["return_all", "one_time_and_sip", "sip_extension"])

const isChoice = (value: string | null): value is Choice => value !== null && CHOICES.has(value)

const choiceOf = (offer: MaturityOfferSummary): Choice | null => (isChoice(offer.chosenOption) ? offer.chosenOption : null)

type BodyInput = Readonly<{
  choice: Choice
  versions: Readonly<{ expectedVersion: number; offerVersion: number }>
  effectiveDate: string
  holding: HoldingFigures | null
}>

const bodyOf = ({ choice, versions, effectiveDate, holding }: BodyInput): ConfirmMaturityOfferBody | null => {
  if (choice === "sip_extension") return { option: choice, ...versions }
  if (holding === null || !NON_NEGATIVE_PAISE.test(holding.principalPaise) || !NON_NEGATIVE_PAISE.test(holding.currentValuePaise)) {
    return null
  }
  if (choice === "return_all") {
    return BigInt(holding.currentValuePaise) > 0n
      ? { option: choice, ...versions, effectiveDate, amountPaise: holding.currentValuePaise }
      : null
  }
  return {
    option: choice,
    ...versions,
    effectiveDate,
    expectedPrincipalPaise: holding.principalPaise,
    expectedCurrentValuePaise: holding.currentValuePaise,
  }
}

const OfferedFigures = ({ choice, offer }: Readonly<{ choice: Choice; offer: MaturityOfferSummary }>): React.ReactElement | null => {
  if (choice === "one_time_and_sip") {
    return (
      <DataList>
        <DetailRow label="New SIP monthly amount">{money(offer.sip.monthlyAmountPaise)}</DetailRow>
        <DetailRow label="First SIP month">{formatYearMonth(offer.sip.startMonth)}</DetailRow>
        <DetailRow label="Months">{String(offer.sip.monthCount)}</DetailRow>
      </DataList>
    )
  }
  if (choice === "sip_extension" && offer.extension !== null) {
    return (
      <DataList>
        <DetailRow label="Months added to the SIP">{String(offer.extension.months)}</DetailRow>
        <DetailRow label="Next maturity date">{formatMaturityDate(offer.extension.nextMaturityDate)}</DetailRow>
      </DataList>
    )
  }
  return null
}

export const MaturityConfirmDialog = ({
  userId,
  schedule,
  offer,
  holding,
  activeSip,
  reload,
  onClose,
}: MaturityConfirmDialogProps): React.ReactElement => {
  const { refreshing, onReload } = reload
  const figures = figuresOf(holding)
  const write = useHeldWrite(useConfirmMaturityOffer(userId), "The confirmation could not be sent. Reload the page and try again.")
  const factsReload = factsReloadOf(reload, write)
  const today = indiaToday()
  const [effectiveDate, setEffectiveDate] = useState(schedule.maturityDate)
  const choice = choiceOf(offer)
  const locked = write.pending || write.outcome.kind === "unknown" || write.outcome.kind === "done"
  const needsDate = choice !== null && choice !== "sip_extension"
  const dateValid = effectiveDate >= schedule.maturityDate && effectiveDate <= today
  const sipKnown = choice === "return_all" || activeSip !== undefined
  const body =
    choice === null
      ? null
      : bodyOf({ choice, versions: { expectedVersion: schedule.version, offerVersion: offer.version }, effectiveDate, holding: figures })
  const ready = body !== null && sipKnown && !refreshing && (!needsDate || dateValid)
  const changedSinceSent = write.outcome.kind === "rejected" && write.outcome.code === "STATE_CONFLICT"

  return (
    <Modal
      open
      title="Confirm the client's choice"
      description={`${schedule.fundName}, maturing ${formatMaturityDate(schedule.maturityDate)}. The client chose: ${
        choice === null ? "nothing yet" : (OPTION_LABELS[choice] ?? choice)
      }. Confirming carries it out now.`}
      onDismiss={() => {
        if (write.held === null && !write.pending) onClose()
      }}
      actions={
        write.outcome.kind === "done" ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button tone="secondary" disabled={write.held !== null || write.pending} onClick={onClose}>
              Go back
            </Button>
            <Button
              disabled={locked || !ready}
              loading={write.pending}
              onClick={() => {
                if (body !== null) write.submit({ scheduleId: schedule.scheduleId, offerId: offer.offerId, body })
              }}
            >
              Confirm the client&apos;s choice
            </Button>
          </>
        )
      }
    >
      {write.outcome.kind === "done" ? (
        <Alert tone="success" title="Choice confirmed">
          {resolutionOutcomeText(write.outcome.result)}
        </Alert>
      ) : choice === null ? (
        <Alert tone="info" title="No choice yet">
          The client has not chosen an option. Nothing happens until they do and you confirm it.
        </Alert>
      ) : (
        <div className={STACK_LG}>
          <HeldWriteNotice write={write} subject="the choice was confirmed" onReload={onReload} />
          {changedSinceSent ? (
            <Alert tone="warning" title="Review the latest">
              {refreshing
                ? "Reading the maturity, holding and SIP schedules again."
                : "Something changed since you opened this. Close it, check the client's current choice and the figures, then confirm again."}
            </Alert>
          ) : null}
          <HoldingFacts holding={holding} reload={factsReload} />
          <OfferedFigures choice={choice} offer={offer} />
          {choice === "return_all" ? null : <ActiveSipFacts choice={choice} activeSip={activeSip} reload={factsReload} />}
          <Alert tone="info" title="What happens">
            {explanationOf(choice, figures)}
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
        </div>
      )}
    </Modal>
  )
}
