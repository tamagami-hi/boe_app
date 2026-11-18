import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { Kysely } from "kysely"

import type { Database } from "../db/types.js"
import { resolveClientPrincipal, type ClientRequestAuthDeps } from "../domain/auth/clientWebAuth.js"
import { foldInvestmentBreakdown, type FundBreakdownFact } from "../domain/client/investmentBreakdown.js"
import { indiaCalendarDate } from "../domain/shared/calendarDate.js"
import type { InvestmentBreakdownRepository } from "../repositories/investmentBreakdownRepository.js"

const BREAKDOWN_ROUTE = "/v1/client/investment-breakdown"

export interface ClientInvestmentBreakdownDeps extends ClientRequestAuthDeps {
  readonly database: Kysely<Database>
  readonly clock: () => Date
  readonly investmentBreakdownRepository: InvestmentBreakdownRepository
}

const basisPoints = (value: bigint | null): string | null => (value === null ? null : value.toString())

const mapFund = (fund: FundBreakdownFact, fundName: string): Record<string, unknown> => {
  const ready = fund.status === "ready"
  return {
    fundId: fund.fundId,
    fundName,
    status: fund.status,
    sips: ready
      ? fund.sips.map((block) => ({
          scheduleId: block.scheduleId,
          state: block.state,
          investedPaise: block.investedPaise.toString(),
          valuePaise: block.valuePaise.toString(),
          growthPaise: block.growthPaise.toString(),
          simpleReturnBasisPoints: basisPoints(block.simpleReturnBasisPoints),
          xirrBasisPoints: basisPoints(block.xirrBasisPoints),
          monthsPaid: block.monthsPaid,
          monthsTotal: block.monthsTotal,
        }))
      : [],
    oneTime: ready
      ? fund.oneTime.map((block) => ({
          entryId: block.entryId,
          effectiveDate: block.effectiveDate,
          investedPaise: block.investedPaise.toString(),
          valuePaise: block.valuePaise.toString(),
          growthPaise: block.growthPaise.toString(),
          simpleReturnBasisPoints: basisPoints(block.simpleReturnBasisPoints),
          reversed: block.reversed,
        }))
      : [],
    lines: ready ? fund.lines.map((line) => ({ kind: line.kind, valuePaise: line.valuePaise.toString() })) : [],
  }
}

export const logUnbalancedFunds = (log: FastifyBaseLogger, userId: string, funds: readonly FundBreakdownFact[]): void => {
  for (const fund of funds) {
    if (fund.preparingReason !== "sum_mismatch") continue
    log.error(
      { userId, fundId: fund.fundId, positionValuePaise: fund.positionValuePaise.toString() },
      "investment breakdown does not add up to the position value",
    )
  }
}

const getBreakdown = async (deps: ClientInvestmentBreakdownDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveClientPrincipal(request, deps)
  const asOfDate = indiaCalendarDate(deps.clock())
  const { funds, names } = await deps.database
    .transaction()
    .setIsolationLevel("repeatable read")
    .execute(async (tx) => {
      const input = await deps.investmentBreakdownRepository.loadBreakdownInput(tx, principal.userId)
      const folded = foldInvestmentBreakdown(input, asOfDate)
      return { funds: folded, names: await deps.investmentBreakdownRepository.fundNames(tx, folded.map((fund) => fund.fundId)) }
    })
  logUnbalancedFunds(request.log, principal.userId, funds)
  const items = funds
    .map((fund) => mapFund(fund, names.get(fund.fundId) ?? ""))
    .sort((left, right) => String(left.fundName).localeCompare(String(right.fundName)))
  return reply.sendData({ asOfDate, funds: items }, { status: 200 })
}

export const registerClientInvestmentBreakdownRoutes = (
  application: FastifyInstance,
  deps: ClientInvestmentBreakdownDeps,
): void => {
  application.get(BREAKDOWN_ROUTE, (request, reply) => getBreakdown(deps, request, reply))
}
