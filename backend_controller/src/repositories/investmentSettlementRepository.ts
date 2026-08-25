import type { InvestmentAllocation, Transaction } from "../db/repositories.js"

export interface SystemAllocationInput {
  readonly orderId: string
  readonly userId: string
  readonly fundId: string
  readonly amountPaise: string
  readonly allocatedAt: Date
  readonly requestId: string
}

export interface SystemContributionInput extends SystemAllocationInput {
  readonly allocationId: string
  readonly paymentId: string
}

export interface SystemInvestmentSettlementAuditInput {
  readonly orderId: string
  readonly paymentId: string
  readonly userId: string
  readonly fundId: string
  readonly amountPaise: string
  readonly requestId: string
  readonly entityVersion: number
}

export interface InvestmentSettlementRepository {
  createPendingFundReceiptAcknowledgement: (tx: Transaction, orderId: string) => Promise<void>
  insertSystemAllocation: (tx: Transaction, input: SystemAllocationInput) => Promise<InvestmentAllocation>
  insertSystemContribution: (tx: Transaction, input: SystemContributionInput) => Promise<void>
  hasCompletedInvestmentSettlement: (
    tx: Transaction,
    input: Readonly<{ orderId: string; paymentId: string }>,
  ) => Promise<boolean>
  recordSystemInvestmentSettlement: (
    tx: Transaction,
    input: SystemInvestmentSettlementAuditInput,
  ) => Promise<void>
}

export const createInvestmentSettlementRepository = (): InvestmentSettlementRepository => ({
  createPendingFundReceiptAcknowledgement: async (tx, orderId) => {
    await tx
      .insertInto("fund_receipt_acknowledgements")
      .values({ order_id: orderId })
      .onConflict((builder) => builder.column("order_id").doNothing())
      .execute()
  },

  insertSystemAllocation: async (tx, input) =>
    tx
      .insertInto("investment_allocations")
      .values({
        order_id: input.orderId,
        user_id: input.userId,
        fund_id: input.fundId,
        amount_paise: input.amountPaise,
        actor_type: "system",
        allocated_by_user_id: null,
        allocated_at: input.allocatedAt,
        request_id: input.requestId,
      })
      .returningAll()
      .executeTakeFirstOrThrow(),

  insertSystemContribution: async (tx, input) => {
    await tx
      .insertInto("client_value_entries")
      .values({
        user_id: input.userId,
        fund_id: input.fundId,
        allocation_id: input.allocationId,
        entry_type: "contribution",
        principal_delta_paise: input.amountPaise,
        value_delta_paise: input.amountPaise,
        effective_date: input.allocatedAt.toISOString().slice(0, 10),
        order_id: input.orderId,
        payment_id: input.paymentId,
        reason_code: "verified_payment_received",
        actor_type: "system",
        created_by_user_id: null,
        request_id: input.requestId,
      })
      .execute()
  },

  hasCompletedInvestmentSettlement: async (tx, input) => {
    const row = await tx
      .selectFrom("investment_allocations as allocation")
      .innerJoin("client_value_entries as entry", (join) =>
        join
          .onRef("entry.allocation_id", "=", "allocation.id")
          .onRef("entry.order_id", "=", "allocation.order_id"),
      )
      .innerJoin("fund_receipt_acknowledgements as acknowledgement", "acknowledgement.order_id", "allocation.order_id")
      .innerJoin("investment_orders as settlement_order", "settlement_order.id", "allocation.order_id")
      .innerJoin("payments as settlement_payment", "settlement_payment.id", "entry.payment_id")
      .innerJoin("audit_events as settlement_audit", (join) =>
        join
          .onRef("settlement_audit.entity_id", "=", "allocation.order_id")
          .on("settlement_audit.command", "in", ["investment_payment.settle", "investment_payment.settlement_migrated"]),
      )
      .select("allocation.id")
      .where("allocation.order_id", "=", input.orderId)
      .where("entry.payment_id", "=", input.paymentId)
      .where("entry.entry_type", "=", "contribution")
      .whereRef("allocation.user_id", "=", "settlement_order.user_id")
      .whereRef("allocation.fund_id", "=", "settlement_order.fund_id")
      .whereRef("allocation.amount_paise", "=", "settlement_order.amount_paise")
      .whereRef("entry.user_id", "=", "settlement_order.user_id")
      .whereRef("entry.fund_id", "=", "settlement_order.fund_id")
      .whereRef("entry.principal_delta_paise", "=", "settlement_payment.amount_paise")
      .whereRef("entry.value_delta_paise", "=", "settlement_payment.amount_paise")
      .whereRef("settlement_payment.order_id", "=", "settlement_order.id")
      .whereRef("settlement_payment.user_id", "=", "settlement_order.user_id")
      .whereRef("allocation.amount_paise", "=", "settlement_payment.amount_paise")
      .where("settlement_order.state", "=", "accepted")
      .where("settlement_payment.state", "=", "succeeded")
      .whereRef("settlement_audit.request_id", "=", "settlement_payment.id")
      .where("acknowledgement.state", "in", ["pending", "acknowledged"])
      .executeTakeFirst()
    return row !== undefined
  },

  recordSystemInvestmentSettlement: async (tx, input) => {
    await tx
      .insertInto("audit_events")
      .values({
        actor_type: "system",
        actor_user_id: null,
        command: "investment_payment.settle",
        entity_type: "investment_order",
        entity_id: input.orderId,
        from_state: "payment_pending",
        to_state: "accepted",
        request_id: input.requestId,
        entity_version: String(input.entityVersion),
        metadata: JSON.stringify({
          paymentId: input.paymentId,
          userId: input.userId,
          fundId: input.fundId,
          amountPaise: input.amountPaise,
        }),
      })
      .execute()
  },
})
