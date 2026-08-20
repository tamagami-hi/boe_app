import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"

import type { UnitOfWork } from "../db/database.js"
import type { SipPlan, UserId } from "../db/repositories.js"
import { authenticateNativeRequest, type NativeRequestAuthDeps } from "../domain/auth/nativeAuth.js"
import { deriveInvestingEligibility } from "../domain/client/investingEligibility.js"
import { AppError } from "../http/errorCatalog.js"
import { parseOrThrow } from "../http/validation.js"
import type { OrderWriteRepository } from "../repositories/orderRepository.js"
import type { SipPlanRepository } from "../repositories/sipPlanRepository.js"
import type { UserWriteRepository } from "../repositories/userRepository.js"

export interface ClientSipDeps extends NativeRequestAuthDeps {
  readonly unitOfWork: UnitOfWork
  readonly clock: () => Date
  readonly sipPlanRepository: SipPlanRepository
  readonly orderRepository: OrderWriteRepository
  readonly userRepository: UserWriteRepository
}

const SIPS_ROUTE = "/v1/client/sips"

const createSipBodySchema = z
  .object({
    fundId: z.string().uuid(),
    amountPaise: z.string().regex(/^[1-9][0-9]*$/u),
    debitDay: z.number().int().min(1).max(28).default(1),
    durationMonths: z.number().int().min(1).max(600).optional(),
  })
  .strict()

const sipParamsSchema = z.object({ sipPlanId: z.string().uuid() }).strict()

const iso = (value: Date | string): string => new Date(value).toISOString()
const isoOrNull = (value: Date | string | null): string | null => (value === null ? null : iso(value))

const mapSip = (plan: SipPlan): Record<string, unknown> => ({
  sipId: plan.id,
  fundId: plan.fund_id,
  status: plan.state,
  amountPaise: plan.amount_paise,
  debitDay: plan.debit_day,
  durationMonths: plan.duration_months,
  nextDueDate: plan.next_due_date,
  startDate: plan.start_date,
  pausedAt: isoOrNull(plan.paused_at),
  cancelledAt: isoOrNull(plan.cancelled_at),
  createdAt: iso(plan.created_at),
})

const createSip = async (deps: ClientSipDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await authenticateNativeRequest(request, deps)
  const body = parseOrThrow(createSipBodySchema, request.body)
  const now = deps.clock()

  const plan = await deps.unitOfWork.execute(async (tx) => {
    const user = await deps.userRepository.lockById(tx, principal.userId as UserId)
    if (user === null) throw new AppError("RESOURCE_NOT_FOUND")
    const compliance = await deps.orderRepository.latestCompliance(tx, principal.userId)
    const { eligibility } = deriveInvestingEligibility({
      accountState: user.account_state,
      kyc:
        compliance.kycState === null
          ? null
          : {
              state: compliance.kycState,
              expiresAt: compliance.kycExpiresAt === null ? null : new Date(compliance.kycExpiresAt).toISOString(),
            },
      riskState: compliance.riskState,
      now,
    })
    if (eligibility === "suspended" || eligibility === "blocked") throw new AppError("ACCOUNT_NOT_ACTIVE")
    if (eligibility !== "eligible") throw new AppError("STATE_CONFLICT")

    const terms = await deps.orderRepository.findFundOrderTerms(tx, body.fundId)
    if (terms === null || terms.fundState !== "published" || terms.minimumSipPaise === null) {
      throw new AppError("STATE_CONFLICT")
    }
    if (BigInt(body.amountPaise) < BigInt(terms.minimumSipPaise)) {
      throw new AppError("VALIDATION_FAILED", {
        fields: { amountPaise: [`amount is below the minimum of ${terms.minimumSipPaise} paise`] },
      })
    }

    return deps.sipPlanRepository.create(tx, {
      userId: principal.userId,
      fundId: body.fundId,
      amountPaise: body.amountPaise,
      debitDay: body.debitDay,
      durationMonths: body.durationMonths ?? null,
      now,
    })
  })

  return reply.sendData(mapSip(plan), { status: 201 })
}

const listSips = async (deps: ClientSipDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await authenticateNativeRequest(request, deps)
  const rows = await deps.unitOfWork.execute((tx) => deps.sipPlanRepository.listByUser(tx, principal.userId))
  return reply.sendData({ items: rows.map(mapSip) }, { status: 200 })
}

const controlSip = (
  action: "pause" | "resume" | "cancel",
) => async (deps: ClientSipDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await authenticateNativeRequest(request, deps)
  const params = parseOrThrow(sipParamsSchema, request.params)

  const plan = await deps.unitOfWork.execute(async (tx) => {
    const existing = await deps.sipPlanRepository.lockById(tx, {
      sipPlanId: params.sipPlanId,
      userId: principal.userId,
    })
    if (existing === null) throw new AppError("RESOURCE_NOT_FOUND")
    const now = deps.clock()
    const updated =
      action === "pause"
        ? await deps.sipPlanRepository.markPaused(tx, params.sipPlanId, now)
        : action === "resume"
          ? await deps.sipPlanRepository.markResumed(tx, params.sipPlanId, now)
          : await deps.sipPlanRepository.markCancelled(tx, params.sipPlanId, now)
    if (updated === null) throw new AppError("STATE_CONFLICT")
    return updated
  })

  return reply.sendData(mapSip(plan), { status: 200 })
}

export const registerClientSipPlanRoutes = (application: FastifyInstance, deps: ClientSipDeps): void => {
  application.post(SIPS_ROUTE, async (request, reply) => createSip(deps, request, reply))
  application.get(SIPS_ROUTE, async (request, reply) => listSips(deps, request, reply))
  application.post(`${SIPS_ROUTE}/:sipPlanId/pause`, async (request, reply) =>
    controlSip("pause")(deps, request, reply),
  )
  application.post(`${SIPS_ROUTE}/:sipPlanId/resume`, async (request, reply) =>
    controlSip("resume")(deps, request, reply),
  )
  application.post(`${SIPS_ROUTE}/:sipPlanId/cancel`, async (request, reply) =>
    controlSip("cancel")(deps, request, reply),
  )
}
