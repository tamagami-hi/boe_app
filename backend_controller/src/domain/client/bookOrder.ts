/**
 * bookOrder command — Option B money model.
 *
 * A `payment_confirmed` purchase or SIP installment is booked by appending **one
 * dated ledger entry** for the money received, in the same transaction as the
 * order's state transition:
 *
 *   Total Investment += amount   (principal delta)
 *   Current Value    += amount   (value delta)
 *
 * There is no unit allotment and no NAV: an investor's ownership is the money
 * they contributed, and growth arrives separately as an administrator-allocated
 * gain (see `allocateGain`). Consequently there is no execution row, holding row,
 * acquisition lot, or lot movement to write — the ledger is the record.
 *
 * The order lock serializes concurrent bookings, and the partial unique index on
 * `investor_ledger_entries.payment_id` makes a replayed settlement pass a no-op
 * rather than a double credit.
 */
import type { InvestmentOrder, Transaction } from "../../db/repositories.js"
import { AppError } from "../../http/errorCatalog.js"
import type { AuditWriteRepository } from "../../repositories/auditRepository.js"
import type {
  InvestorLedgerRepository,
  LedgerEntryRow,
} from "../../repositories/investorLedgerRepository.js"
import type { NotificationWriteRepository } from "../../repositories/notificationRepository.js"
import type { OrderWriteRepository } from "../../repositories/orderRepository.js"

export interface BookOrderDeps {
  readonly orderRepository: OrderWriteRepository
  readonly investorLedgerRepository: InvestorLedgerRepository
  readonly notificationRepository: NotificationWriteRepository
  readonly auditRepository: AuditWriteRepository
  readonly clock: () => Date
}

export interface BookOrderInput {
  readonly userId: string
  readonly orderId: string
  readonly requestId: string
  /** Set when booking follows a payment, so the ledger entry is idempotent. */
  readonly paymentId?: string | null
}

export interface BookOrderResult {
  readonly order: InvestmentOrder
  readonly entry: LedgerEntryRow
}

const rupees = (paise: string): string => (Number(paise) / 100).toLocaleString("en-IN")

export const bookOrder = async (
  tx: Transaction,
  deps: BookOrderDeps,
  input: BookOrderInput,
): Promise<BookOrderResult> => {
  const now = deps.clock()

  // Lock the order; only a payment-confirmed contribution is bookable.
  const locked = await deps.orderRepository.lockById(tx, { orderId: input.orderId, userId: input.userId })
  if (locked === null) throw new AppError("RESOURCE_NOT_FOUND")
  if (locked.type !== "purchase" && locked.type !== "sip_installment") throw new AppError("STATE_CONFLICT")
  if (locked.amount_paise === null) throw new AppError("STATE_CONFLICT")

  const amountPaise = String(locked.amount_paise)

  // Guarded transition: payment_confirmed -> booked.
  const order = await deps.orderRepository.book(tx, { orderId: input.orderId, userId: input.userId, now })
  if (order === null) throw new AppError("STATE_CONFLICT")

  const entry = await deps.investorLedgerRepository.append(tx, {
    userId: input.userId,
    fundId: order.fund_id,
    entryType: order.type === "sip_installment" ? "sip_installment" : "lump_sum",
    // A contribution moves invested principal and current value in step.
    principalDeltaPaise: amountPaise,
    valueDeltaPaise: amountPaise,
    amountPaise,
    effectiveDate: now.toISOString().slice(0, 10),
    orderId: order.id,
    paymentId: input.paymentId ?? null,
    requestId: input.requestId,
    metadata: { orderType: order.type },
  })

  await deps.notificationRepository.create(tx, {
    userId: input.userId,
    kind: "order_booked",
    title: "Investment recorded",
    body: `₹${rupees(amountPaise)} has been added to your investment.`,
    payload: { orderId: order.id, fundId: order.fund_id, amountPaise, ledgerEntryId: entry.id },
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
    metadata: { ledgerEntryId: entry.id, amountPaise, entryType: entry.entryType },
  })

  return { order, entry }
}
