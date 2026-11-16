import type { Transaction, User } from "../../db/repositories.js"
import { AppError } from "../../http/errorCatalog.js"
import type { ActiveClientLockRepository } from "../../repositories/activeClientLockRepository.js"

export interface ActiveClientLockDeps {
  readonly activeClientLockRepository: ActiveClientLockRepository
}

export const refuseInactiveClient = (user: Pick<User, "account_state" | "pii_tombstoned_at">): void => {
  if (user.account_state !== "active" || user.pii_tombstoned_at !== null) throw new AppError("ACCOUNT_NOT_ACTIVE")
}

export const lockActiveClient = async (tx: Transaction, deps: ActiveClientLockDeps, userId: string): Promise<void> => {
  if (!(await deps.activeClientLockRepository.lockActive(tx, userId))) throw new AppError("ACCOUNT_NOT_ACTIVE")
}
