import type { Transaction } from "../../db/repositories.js"
import { AppError } from "../../http/errorCatalog.js"
import type { AuditWriteRepository } from "../../repositories/auditRepository.js"
import type { ClientGrowthRepository } from "../../repositories/clientGrowthRepository.js"
import type { ClientPositionRepository } from "../../repositories/clientPositionRepository.js"
import type { NotificationWriteRepository } from "../../repositories/notificationRepository.js"
import type { UserWriteRepository } from "../../repositories/userRepository.js"
import type { UserId } from "../../db/repositories.js"

export interface RecordContributionDeps {
  readonly clientPositionRepository: ClientPositionRepository
  readonly clientGrowthRepository: ClientGrowthRepository
  readonly userRepository: UserWriteRepository
  readonly auditRepository: AuditWriteRepository
  readonly notificationRepository: NotificationWriteRepository
  readonly clock: () => Date
}

export interface RecordContributionInput {
  readonly userId: string
  readonly fundId: string
  readonly amountPaise: bigint
  readonly effectiveDate: string
  readonly reasonCode: string
  readonly note: string | null
  readonly actorUserId: string
  readonly requestId: string
}

export interface RecordedContribution {
  readonly entryId: string
  readonly orderId: string
  readonly paymentId: string
  readonly allocationId: string
  readonly fundVersionId: string
  readonly fundVersionHistorical: boolean
  readonly principalPaise: bigint
  readonly currentValuePaise: bigint
}

export const RECORDED_CONTRIBUTION_NOTIFICATION = Object.freeze({
  kind: "client_contribution_recorded",
  title: "An earlier investment was added",
  body:
    "An investment you made before you joined the app has been added to your portfolio. " +
    "Open your portfolio to check it, and contact support if you do not recognise it.",
})

const midday = (effectiveDate: string): Date => new Date(`${effectiveDate}T12:00:00.000Z`)

export const recordContribution = async (
  tx: Transaction,
  deps: RecordContributionDeps,
  input: RecordContributionInput,
): Promise<RecordedContribution> => {
  await deps.clientGrowthRepository.lockPosition(tx, input.userId, input.fundId)

  const user = await deps.userRepository.lockById(tx, input.userId as UserId)
  if (user === null) throw new AppError("RESOURCE_NOT_FOUND")

  const version = await deps.clientPositionRepository.findFundVersionForDate(tx, {
    fundId: input.fundId,
    effectiveDate: input.effectiveDate,
  })
  if (version === null) throw new AppError("RESOURCE_NOT_FOUND")

  const occurredAt = midday(input.effectiveDate)

  const order = await deps.clientPositionRepository.insertRecordedOrder(tx, {
    userId: input.userId,
    fundId: input.fundId,
    fundVersionId: version.fundVersionId,
    amountPaise: input.amountPaise,
    occurredAt,
  })
  const payment = await deps.clientPositionRepository.insertRecordedPayment(tx, {
    orderId: order.id,
    userId: input.userId,
    amountPaise: input.amountPaise,
    occurredAt,
  })
  const allocation = await deps.clientPositionRepository.insertRecordedAllocation(tx, {
    orderId: order.id,
    userId: input.userId,
    fundId: input.fundId,
    amountPaise: input.amountPaise,
    actorUserId: input.actorUserId,
    occurredAt,
    requestId: input.requestId,
  })
  const entry = await deps.clientPositionRepository.insertContributionEntry(tx, {
    userId: input.userId,
    fundId: input.fundId,
    orderId: order.id,
    paymentId: payment.id,
    allocationId: allocation.id,
    amountPaise: input.amountPaise,
    effectiveDate: input.effectiveDate,
    reasonCode: input.reasonCode,
    note: input.note,
    actorUserId: input.actorUserId,
    requestId: input.requestId,
  })

  const basis = await deps.clientGrowthRepository.findPositionBasis(tx, input.userId, input.fundId)
  if (basis === null) throw new AppError("INTERNAL_ERROR")

  await deps.auditRepository.append(tx, {
    actorType: "admin",
    actorUserId: input.actorUserId,
    command: "client_position.contribution_recorded",
    entityType: "client_value_entry",
    entityId: entry.id,
    toState: "contribution",
    requestId: input.requestId,
    entityVersion: 1,
    metadata: {
      userId: input.userId,
      fundId: input.fundId,
      orderId: order.id,
      paymentId: payment.id,
      allocationId: allocation.id,
      orderType: "recorded_offline",
      amountPaise: input.amountPaise.toString(),
      effectiveDate: input.effectiveDate,
      recordedAt: deps.clock().toISOString(),
      reasonCode: input.reasonCode,
      fundVersionId: version.fundVersionId,
      fundVersionEffectiveOnDate: version.historical,
      paymentAttemptCreated: false,
    },
  })

  await deps.notificationRepository.create(tx, {
    userId: input.userId,
    kind: RECORDED_CONTRIBUTION_NOTIFICATION.kind,
    title: RECORDED_CONTRIBUTION_NOTIFICATION.title,
    body: RECORDED_CONTRIBUTION_NOTIFICATION.body,
    payload: { fundId: input.fundId },
  })

  return {
    entryId: entry.id,
    orderId: order.id,
    paymentId: payment.id,
    allocationId: allocation.id,
    fundVersionId: version.fundVersionId,
    fundVersionHistorical: version.historical,
    principalPaise: BigInt(basis.principalPaise),
    currentValuePaise: BigInt(basis.currentValuePaise),
  }
}
