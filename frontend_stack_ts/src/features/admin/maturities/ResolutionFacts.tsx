import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { Button } from "~/ui/primitives/Button"
import { Alert } from "~/ui/primitives/Feedback"

import {
  gainOf,
  money,
  type ActiveSip,
  type Choice,
  type FactsReload,
  type HoldingFigures,
  type HoldingRead,
} from "./resolutionCopy"

export type ResolutionFactsProps = Readonly<{
  choice: Choice
  holding: HoldingRead
  activeSip: ActiveSip | null | undefined
  reload: FactsReload
}>

const gainText = (holding: HoldingFigures): string => {
  const gain = gainOf(holding)
  if (gain === 0n) return "None"
  return gain > 0n ? `Gain of ${money(gain.toString())}` : `Loss of ${money((-gain).toString())}`
}

const ReadAgain = ({ reload }: Readonly<{ reload: FactsReload }>): React.ReactElement => (
  <Button size="sm" tone="secondary" loading={reload.refreshing} onClick={reload.onReload}>
    Read again
  </Button>
)

const SipFigures = ({ activeSip }: Readonly<{ activeSip: ActiveSip }>): React.ReactElement => (
  <DataList>
    <DetailRow label="Monthly amount">{money(activeSip.monthlyAmountPaise)}</DetailRow>
    <DetailRow label="Months paid">{`${String(activeSip.monthsPaid)} of ${String(activeSip.monthCount)}`}</DetailRow>
    <DetailRow label="Months remaining">{String(Math.max(activeSip.monthCount - activeSip.monthsPaid, 0))}</DetailRow>
  </DataList>
)

export const ActiveSipFacts = ({
  choice,
  activeSip,
  reload,
}: Readonly<{
  choice: Exclude<Choice, "return_all">
  activeSip: ActiveSip | null | undefined
  reload: FactsReload
}>): React.ReactElement => {
  if (activeSip === undefined) {
    return (
      <Alert tone="error" title="SIP schedules not read" action={<ReadAgain reload={reload} />}>
        The client&apos;s SIP schedules could not be read, so the schedule this option affects cannot be shown. Read them
        again before choosing this option.
      </Alert>
    )
  }
  if (activeSip === null) {
    return choice === "sip_extension" ? (
      <Alert tone="warning" title="No SIP schedule to extend">
        This client has no active SIP schedule for this fund. Choose the one-time option or create a SIP schedule first.
      </Alert>
    ) : (
      <Alert tone="info" title="No SIP schedule to close">This client has no active SIP schedule for this fund.</Alert>
    )
  }
  return (
    <Alert
      tone={choice === "sip_extension" ? "info" : "warning"}
      title={choice === "sip_extension" ? "This extends the active SIP schedule" : "This closes the active SIP schedule"}
    >
      <SipFigures activeSip={activeSip} />
    </Alert>
  )
}

export const HoldingFacts = ({
  holding,
  reload,
}: Readonly<{ holding: HoldingRead; reload: FactsReload }>): React.ReactElement => {
  if (holding.state === "failed") {
    return (
      <Alert tone="error" title="Holding not read" action={<ReadAgain reload={reload} />}>
        The current value could not be read. Read it again before resolving.
      </Alert>
    )
  }
  if (holding.state === "none") {
    return (
      <Alert tone="warning" title="No position in this fund">
        The client holds nothing in this fund now, so there is no value to return or reinvest.
      </Alert>
    )
  }
  return (
    <DataList>
      <DetailRow label="Current value">{money(holding.figures.currentValuePaise)}</DetailRow>
      <DetailRow label="Amount invested">{money(holding.figures.principalPaise)}</DetailRow>
      <DetailRow label="Gain or loss">{gainText(holding.figures)}</DetailRow>
    </DataList>
  )
}

export const ResolutionFacts = ({ choice, holding, activeSip, reload }: ResolutionFactsProps): React.ReactElement => (
  <>
    <HoldingFacts holding={holding} reload={reload} />
    {choice === "return_all" ? null : <ActiveSipFacts choice={choice} activeSip={activeSip} reload={reload} />}
  </>
)
