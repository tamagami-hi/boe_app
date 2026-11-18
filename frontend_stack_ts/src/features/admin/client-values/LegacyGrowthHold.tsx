import { HeldWriteNotice } from "~/features/admin/shared/HeldWriteNotice"
import type { HeldWrite } from "~/features/admin/shared/useHeldWrite"
import { useHeldWrite } from "~/features/admin/shared/useHeldWrite"
import { Alert } from "~/ui/primitives/Feedback"
import { STACK_SM } from "~/ui/recipes/layout"

import { useCommitCollectiveClientGrowth, useIndividualClientGrowth } from "./growthQueries"
import { parseCollectiveCommit, parseIndividualGrowth } from "./heldBodies"

export const LEGACY_COLLECTIVE_SLOT = "collective-growth"
export const LEGACY_SHEET_SLOT = "value-update"
export const legacyIndividualSlot = (userId: string): string => `growth:${userId}`

const UNSENT = "This earlier request could not be sent. Reload the page and try again."

export type LegacyGrowthHold = Readonly<{ locked: boolean; notice: React.ReactNode }>

const legacyHoldOf = <TBody extends object, TResult>(write: HeldWrite<TBody, TResult>): LegacyGrowthHold => {
  const locked = write.held !== null || write.unreadable || write.pending
  if (!locked && write.outcome.kind === "idle") return { locked: false, notice: null }
  return {
    locked,
    notice: (
      <div className={STACK_SM}>
        {locked ? (
          <Alert tone="info" title="An earlier request is held">
            This screen now records growth per investment. A request made before that change is still held in this
            tab, so the screen stays locked until it is settled. Check again sends that same request to the same place
            under the same key, so it can only ever apply once.
          </Alert>
        ) : null}
        <HeldWriteNotice
          write={{
            outcome: write.outcome,
            pending: write.pending,
            checkAgain: write.checkAgain,
            unreadable: write.unreadable,
            expired: write.expired,
            reset: write.reset,
          }}
          subject="the earlier request was written"
          reloadLabel="I checked the record"
          onReload={write.reset}
        />
      </div>
    ),
  }
}

export const useLegacyCollectiveHold = (slot: string): LegacyGrowthHold => {
  const mutation = useCommitCollectiveClientGrowth()
  const write = useHeldWrite(mutation, UNSENT, { slot, parseBody: parseCollectiveCommit, retention: "ordinary" })
  return legacyHoldOf(write)
}

export const useLegacyIndividualHold = (userId: string): LegacyGrowthHold => {
  const mutation = useIndividualClientGrowth()
  const write = useHeldWrite(mutation, UNSENT, {
    slot: legacyIndividualSlot(userId),
    parseBody: parseIndividualGrowth,
    retention: "ordinary",
  })
  return legacyHoldOf(write)
}
