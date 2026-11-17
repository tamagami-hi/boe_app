import type { UserAccountState } from "../../db/types.js"
import { AppError } from "../../http/errorCatalog.js"

export const SELF_LOCKOUT_MESSAGE = "You cannot suspend or close your own account. Another admin can do this."

const LOCKING_STATES: ReadonlySet<UserAccountState> = new Set(["suspended", "closed"])

export const refuseSelfLockout = (actorUserId: string, targetUserId: string, nextState: UserAccountState): void => {
  if (!LOCKING_STATES.has(nextState)) return
  if (actorUserId.toLowerCase() !== targetUserId.toLowerCase()) return
  throw new AppError("AUTHORIZATION_DENIED", { message: SELF_LOCKOUT_MESSAGE })
}
