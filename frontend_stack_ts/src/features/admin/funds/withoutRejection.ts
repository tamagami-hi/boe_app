import type { HeldWrite, HeldWriteOutcome } from "~/features/admin/shared/useHeldWrite"

const IDLE: HeldWriteOutcome<never> = { kind: "idle" }

export const withoutRejection = <TBody, TResult>(write: HeldWrite<TBody, TResult>): HeldWrite<TBody, TResult> =>
  write.outcome.kind === "rejected" ? { ...write, outcome: IDLE } : write
