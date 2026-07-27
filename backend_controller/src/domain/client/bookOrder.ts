/**
 * bookOrder command (spec 03 §5.2 `bookOrder`, §4.3 arithmetic, §6 "Payment
 * success/book"). A system/operations command: a `payment_confirmed` purchase
 * order is booked into immutable financial evidence and the authoritative
 * ownership projection, all in one transaction:
 *   - compute allotted units exactly (units = amount_paise/100/nav, round once
 *     half-to-even at scale 8);
 *   - append the immutable `allotment` execution;
 *   - create or increment the (user, fund) holding;
 *   - create the acquisition lot and its `allotment` lot movement;
 *   - notify the user and append audit.
 *
 * The order lock plus the holding upsert (unique on (user_id, fund_id)) serialize
 * concurrent bookings; executions, lots, and movements are append-only.
 */
import type {
  Holding,
  HoldingLot,
  HoldingLotMovement,
  InvestmentExecution,
  InvestmentOrder,
  Transaction,
} from "../../db/repositories.js"
import { AppError } from "../../http/errorCatalog.js"
import type { AuditWriteRepository } from "../../repositories/auditRepository.js"
import type { HoldingWriteRepository } from "../../repositories/holdingRepository.js"
import type { NotificationWriteRepository } from "../../repositories/notificationRepository.js"
import type { OrderWriteRepository } from "../../repositories/orderRepository.js"
import { computeAllotmentUnits } from "../../finance/money.js"

export interface BookOrderDeps {
  readonly orderRepository: OrderWriteRepository
  readonly holdingRepository: HoldingWriteRepository
  readonly notificationRepository: NotificationWriteRepository
  readonly auditRepository: AuditWriteRepository
  readonly clock: () => Date
}

export interface BookOrderInput {
  readonly userId: string
  readonly orderId: string
  readonly requestId: string
}

export interface BookOrderResult {
  readonly order: InvestmentOrder
  readonly execution: InvestmentExecution
  readonly holding: Holding
  readonly lot: HoldingLot
  readonly movement: HoldingLotMovement
}

export const bookOrder = async (
  tx: Transaction,
  deps: BookOrderDeps,
  input: BookOrderInput,
): Promise<BookOrderResult> => {
  const now = deps.clock()

  // Lock the order; only a payment-confirmed purchase/SIP allotment is bookable.
  const locked = await deps.orderRepository.lockById(tx, { orderId: input.orderId, userId: input.userId })
  if (locked === null) throw new AppError("RESOURCE_NOT_FOUND")
  if (locked.type !== "purchase" && locked.type !== "sip_installment") throw new AppError("STATE_CONFLICT")
  if (locked.amount_paise === null) throw new AppError("STATE_CONFLICT")

  // An applicable current NAV must exist.
  const nav = await deps.holdingRepository.findCurrentNav(tx, locked.fund_id)
  if (nav === null) throw new AppError("STATE_CONFLICT")

  const amountPaise = locked.amount_paise
  const units = computeAllotmentUnits(BigInt(amountPaise), nav.nav)

  // Guarded transition: payment_confirmed -> booked.
  const order = await deps.orderRepository.book(tx, { orderId: input.orderId, userId: input.userId, now })
  if (order === null) throw new AppError("STATE_CONFLICT")

  const execution = await deps.holdingRepository.insertAllotmentExecution(tx, {
    orderId: order.id,
    userId: input.userId,
    fundId: order.fund_id,
    amountPaise,
    nav: nav.nav,
    units,
    now,
  })
  const holding = await deps.holdingRepository.upsertHolding(tx, {
    userId: input.userId,
    fundId: order.fund_id,
    addUnits: units,
    addCostBasisPaise: amountPaise,
  })
  const lot = await deps.holdingRepository.insertLot(tx, {
    holdingId: holding.id,
    userId: input.userId,
    fundId: order.fund_id,
    sourceExecutionId: execution.id,
    acquiredOn: now.toISOString().slice(0, 10),
    costBasisPaise: amountPaise,
    units,
  })
  const movement = await deps.holdingRepository.insertAllotmentMovement(tx, {
    holdingLotId: lot.id,
    holdingId: holding.id,
    userId: input.userId,
    fundId: order.fund_id,
    executionId: execution.id,
    unitsDelta: units,
    costBasisDeltaPaise: amountPaise,
    now,
  })

  await deps.notificationRepository.create(tx, {
    userId: input.userId,
    kind: "order_booked",
    title: "Units allotted",
    body: `Your order for ${units} units has been booked.`,
    payload: { orderId: order.id, fundId: order.fund_id, units },
  })

  await deps.auditRepository.append(tx, {
    actorType: "system",
    command: "order.book",
    entityType: "investment_order",
    entityId: order.id,
    fromState: "payment_confirmed",
    toState: "booked",
    requestId: input.requestId,
    entityVersion: Number(order.version),
    metadata: { executionId: execution.id, units, navAsOf: nav.asOfDate },
  })

  return { order, execution, holding, lot, movement }
}
