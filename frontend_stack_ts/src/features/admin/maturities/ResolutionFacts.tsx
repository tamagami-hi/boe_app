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

const ReplacedSip = ({ activeSip }: Readonly<{ activeSip: ActiveSip | null | undefined }>): React.ReactElement => {
  if (activeSip === undefined) {
    return (
      <Alert tone="error" title="SIP schedules unavailable">
        The client&apos;s SIP schedules could not be read, so the schedule this would close cannot be shown. Reload before choosing this option.
      </Alert>
    )
  }
  if (activeSip === null) {
    return <Alert tone="info" title="No SIP schedule to close">This client has no active SIP schedule for this fund.</Alert>
  }
  return (
    <Alert tone="warning" title="This closes the active SIP schedule">
      <DataList>
        <DetailRow label="Monthly amount">{money(activeSip.monthlyAmountPaise)}</DetailRow>
        <DetailRow label="Months paid">{`${String(activeSip.monthsPaid)} of ${String(activeSip.monthCount)}`}</DetailRow>
        <DetailRow label="Months remaining">{String(Math.max(activeSip.monthCount - activeSip.monthsPaid, 0))}</DetailRow>
      </DataList>
    </Alert>
  )
}

export const ResolutionFacts = ({ choice, holding, activeSip }: ResolutionFactsProps): React.ReactElement => (
  <>
    {holding === null ? (
      <Alert tone="error" title="Holding figures unavailable">
        The current value could not be read. Reload before resolving.
      </Alert>
    ) : (
      <DataList>
        <DetailRow label="Current value">{money(holding.currentValuePaise)}</DetailRow>
        <DetailRow label="Amount invested">{money(holding.principalPaise)}</DetailRow>
        <DetailRow label="Gain or loss">{gainText(holding)}</DetailRow>
      </DataList>
    )}
    {choice === "return_all" ? null : <ReplacedSip activeSip={activeSip} />}
  </>
)
