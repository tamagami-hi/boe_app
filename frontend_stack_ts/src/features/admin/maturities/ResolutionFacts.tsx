import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { Alert } from "~/ui/primitives/Feedback"

import { gainOf, money, type ActiveSip, type Choice, type HoldingFigures } from "./resolutionCopy"

export type ResolutionFactsProps = Readonly<{
  choice: Choice
  holding: HoldingFigures | null
  activeSip: ActiveSip | null | undefined
}>

const gainText = (holding: HoldingFigures): string => {
  const gain = gainOf(holding)
  if (gain === 0n) return "None"
  return gain > 0n ? `Gain of ${money(gain.toString())}` : `Loss of ${money((-gain).toString())}`
}

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
}: Readonly<{ choice: Exclude<Choice, "return_all">; activeSip: ActiveSip | null | undefined }>): React.ReactElement => {
  if (activeSip === undefined) {
    return (
      <Alert tone="error" title="SIP schedules unavailable">
        The client&apos;s SIP schedules could not be read, so the schedule this option affects cannot be shown. Reload before choosing this option.
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

export const HoldingFacts = ({ holding }: Readonly<{ holding: HoldingFigures | null }>): React.ReactElement =>
  holding === null ? (
    <Alert tone="error" title="Holding figures unavailable">
      The current value could not be read. Reload before resolving.
    </Alert>
  ) : (
    <DataList>
      <DetailRow label="Current value">{money(holding.currentValuePaise)}</DetailRow>
      <DetailRow label="Amount invested">{money(holding.principalPaise)}</DetailRow>
      <DetailRow label="Gain or loss">{gainText(holding)}</DetailRow>
    </DataList>
  )

export const ResolutionFacts = ({ choice, holding, activeSip }: ResolutionFactsProps): React.ReactElement => (
  <>
    <HoldingFacts holding={holding} />
    {choice === "return_all" ? null : <ActiveSipFacts choice={choice} activeSip={activeSip} />}
  </>
)
