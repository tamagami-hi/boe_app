import type { Kysely } from "kysely"

import type { Database } from "../db/types.js"
import { holdsSeveralInvestments } from "../domain/admin/investmentGrowthBases.js"
import { AppError } from "../http/errorCatalog.js"
import type { InvestmentBreakdownRepository } from "../repositories/investmentBreakdownRepository.js"

export const UPDATE_FOR_SEVERAL_INVESTMENTS_MESSAGE =
  "Update the admin app to record growth for clients with more than one investment in a fund."

export interface SeveralInvestmentsDeps {
  readonly investmentBreakdownRepository: Pick<InvestmentBreakdownRepository, "loadBreakdownContexts">
}

export const refuseSeveralInvestments = async (
  deps: SeveralInvestmentsDeps,
  db: Kysely<Database>,
  fundId: string,
  userIds: readonly string[],
): Promise<void> => {
  if (userIds.length === 0) return
  const contexts = await deps.investmentBreakdownRepository.loadBreakdownContexts(db, userIds)
  for (const userId of userIds) {
    const input = contexts.get(userId)?.input
    if (input === undefined) throw new AppError("INTERNAL_ERROR")
    if (holdsSeveralInvestments(input, fundId)) {
      throw new AppError("AUTHORIZATION_DENIED", { message: UPDATE_FOR_SEVERAL_INVESTMENTS_MESSAGE })
    }
  }
}
