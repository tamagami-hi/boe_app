import { useEffect } from "react"

import { Section } from "~/app/layouts/Section"
import { HeldWriteNotice, isUnsavedHold, UnsavedHoldNotice } from "~/features/admin/shared/HeldWriteNotice"
import { useHeldWrite } from "~/features/admin/shared/useHeldWrite"
import { useUnloadGuard } from "~/features/admin/shared/useUnloadGuard"
import { MoneyFootnote } from "~/ui/patterns/MoneyFootnote"
import { Button } from "~/ui/primitives/Button"
import { Alert } from "~/ui/primitives/Feedback"

import { EarlierGrowthFundForm } from "./EarlierGrowthFundForm"
import { needsSplit, splitFormKeyOf } from "./investmentCleanup"
import {
  earlierGrowthSplitSlot,
  parseEarlierGrowthSplit,
  useClientInvestments,
  useConfirmEarlierGrowthSplit,
} from "./investmentCleanupQueries"
import { ListSkeleton } from "./ListSkeleton"

const UNSENT = "The split could not be sent. Reload the earlier growth and try again."
const STALE_CUTOFF = "The earlier growth changed. Reload to see the new total."
const RELOAD = "Reload"

export type EarlierGrowthPanelProps = Readonly<{
  userId: string
  investorLabel: string
  onHoldChange?: (holding: boolean) => void
}>

export const EarlierGrowthPanel = ({
  userId,
  investorLabel,
  onHoldChange,
}: EarlierGrowthPanelProps): React.ReactElement | null => {
  const investments = useClientInvestments(userId)
  const split = useHeldWrite(useConfirmEarlierGrowthSplit(userId), UNSENT, {
    slot: earlierGrowthSplitSlot(userId),
    parseBody: parseEarlierGrowthSplit,
  })
  const isHolding = isUnsavedHold(split)
  useUnloadGuard(isHolding)

  useEffect(() => {
    onHoldChange?.(isHolding)
    return () => {
      onHoldChange?.(false)
    }
  }, [isHolding, onHoldChange])
  const busy = split.pending || split.outcome.kind === "unknown"
  const isStale = split.outcome.kind === "rejected" && split.outcome.code === "STATE_CONFLICT"

  const reload = (): void => {
    if (isStale) split.reset()
    void investments.refetch()
  }

  if (investments.isPending) return investments.fetchStatus === "idle" ? null : <ListSkeleton />
  if (investments.isError) {
    return (
      <Alert
        tone="warning"
        title="Earlier growth not loaded"
        action={
          <Button size="sm" tone="secondary" loading={investments.isFetching} onClick={reload}>
            Try again
          </Button>
        }
      >
        It could not be checked whether this client has earlier growth to split between investments.
      </Alert>
    )
  }

  const pending = investments.data.funds.filter(needsSplit)
  if (pending.length === 0 && split.outcome.kind === "idle" && !split.unreadable) return null

  return (
    <Section
      title="Earlier growth"
      description="Growth recorded for a whole fund before it was kept per investment. Split it between this client's investments in the fund: the amounts start from a split by value and must add up to the total. The client gets no email for this."
    >
      {split.outcome.kind === "done" ? (
        <Alert tone="success" title="Earlier growth split confirmed">
          The client&apos;s breakdown for this fund uses the split. No email was sent.
        </Alert>
      ) : isStale ? (
        <Alert
          tone="warning"
          title="Nothing changed"
          action={
            <Button size="sm" tone="secondary" loading={investments.isFetching} onClick={reload}>
              {RELOAD}
            </Button>
          }
        >
          {STALE_CUTOFF}
        </Alert>
      ) : (
        <HeldWriteNotice write={split} subject="the split was confirmed" onReload={reload} reloadLabel={RELOAD} />
      )}
      <UnsavedHoldNotice write={split} />
      {pending.map((fund) => (
        <EarlierGrowthFundForm
          key={splitFormKeyOf(fund)}
          fund={fund}
          investorLabel={investorLabel}
          busy={busy || isStale}
          onConfirm={(body) => {
            if (split.outcome.kind !== "idle") split.reset()
            split.submit({ fundId: fund.fundId, ...body })
          }}
        />
      ))}
      <MoneyFootnote lastUpdated={null} />
    </Section>
  )
}
