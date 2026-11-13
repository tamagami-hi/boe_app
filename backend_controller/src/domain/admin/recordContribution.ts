import type { Transaction, User } from "../../db/repositories.js"
import { AppError } from "../../http/errorCatalog.js"
import type { AuditWriteRepository } from "../../repositories/auditRepository.js"
import type { ClientGrowthRepository } from "../../repositories/clientGrowthRepository.js"
import type { ClientPositionRepository } from "../../repositories/clientPositionRepository.js"
import type { NotificationWriteRepository } from "../../repositories/notificationRepository.js"
import type { UserWriteRepository } from "../../repositories/userRepository.js"
import type { UserId } from "../../db/repositories.js"
import type { UserAccountState } from "../../db/types.js"
import {
  queueInvestmentRecordedMail,
  type EmailedRecordingCategory,
  type InvestmentRecordedMailDeps,
} from "../email/investmentRecordedMail.js"
import {
  RECORDING_CATEGORY_TEXT,
  recordingCategoryOf,
  type RecordingCategory,
  type RecordingReasonCode,
} from "../shared/recordingCategory.js"

export interface RecordContributionDeps extends InvestmentRecordedMailDeps {
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
  readonly reasonCode: RecordingReasonCode
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
  deepLink: "/portfolio",
})

const RECORDABLE_ACCOUNT_STATES: ReadonlySet<UserAccountState> = new Set(["active", "suspended"])
const NOT_RECORDABLE_STATE_MESSAGE = "Investments can only be recorded for an active or suspended client account."
const NOT_A_CLIENT_MESSAGE = "Investments can only be recorded for client accounts."

const emailedCategory = (category: RecordingCategory): EmailedRecordingCategory | null =>
  category === "correction" ? null : category

const canReceiveMail = (user: User): boolean => user.account_state === "active" && user.pii_tombstoned_at === null

const midday = (effectiveDate: string): Date => new Date(`${effectiveDate}T12:00:00.000Z`)

const requireRecordableClient = async (
  tx: Transaction,
  deps: RecordContributionDeps,
  userId: UserId,
): Promise<User> => {
  const user = await deps.userRepository.lockById(tx, userId)
  if (user === null) throw new AppError("RESOURCE_NOT_FOUND")
  if (!RECORDABLE_ACCOUNT_STATES.has(user.account_state)) {
    throw new AppError("STATE_CONFLICT", { message: NOT_RECORDABLE_STATE_MESSAGE })
  }
  const grants = await deps.userRepository.findActiveRolesAndPermissions(tx, userId)
  if (grants.roles.length > 0) throw new AppError("STATE_CONFLICT", { message: NOT_A_CLIENT_MESSAGE })
  return user
}

export const recordContribution = async (
  tx: Transaction,
  deps: RecordContributionDeps,
  input: RecordContributionInput,
): Promise<RecordedContribution> => {
  const category = recordingCategoryOf(input.reasonCode)
  await deps.clientGrowthRepository.lockPosition(tx, input.userId, input.fundId)
  const client = await requireRecordableClient(tx, deps, input.userId as UserId)

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
      category,
      fundVersionId: version.fundVersionId,
      fundVersionEffectiveOnDate: version.historical,
      paymentAttemptCreated: false,
    },
  })

  const text = RECORDING_CATEGORY_TEXT[category]
  await deps.notificationRepository.create(tx, {
    userId: input.userId,
    kind: RECORDED_CONTRIBUTION_NOTIFICATION.kind,
    title: text.notificationTitle,
    body: text.notificationBody(version.fundName),
    payload: {
      fundId: input.fundId,
      deepLink: RECORDED_CONTRIBUTION_NOTIFICATION.deepLink,
      entryId: entry.id,
      orderId: order.id,
      category,
    },
  })

  const mailCategory = emailedCategory(category)
  if (mailCategory !== null && canReceiveMail(client)) {
    await queueInvestmentRecordedMail(tx, deps, {
      recipient: client,
      entryId: entry.id,
      fundName: version.fundName,
      amountPaise: input.amountPaise,
      effectiveDate: input.effectiveDate,
      category: mailCategory,
      requestId: input.requestId,
    })
  }

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
