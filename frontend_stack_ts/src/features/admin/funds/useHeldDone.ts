import { useEffect, useRef } from "react"

import type { HeldWriteOutcome } from "~/features/admin/shared/useHeldWrite"

export const useHeldDone = <TResult>(outcome: HeldWriteOutcome<TResult>, onDone: (result: TResult) => void): void => {
  const latest = useRef(onDone)
  latest.current = onDone
  useEffect(() => {
    if (outcome.kind === "done") latest.current(outcome.result)
  }, [outcome])
}
