import type { Transaction, User } from "../../db/repositories.js"
import { AppError } from "../../http/errorCatalog.js"
import type { AdminSipScheduleRepository } from "../../repositories/adminSipScheduleRepository.js"
import type { AuditWriteRepository } from "../../repositories/auditRepository.js"
import type { ClientGrowthRepository } from "../../repositories/clientGrowthRepository.js"
import type { ClientPositionRepository } from "../../repositories/clientPositionRepository.js"
import type { NotificationWriteRepository } from "../../repositories/notificationRepository.js"
import type { RecordingCategoryRepository } from "../../repositories/recordingCategoryRepository.js"
import type { UserWriteRepository } from "../../repositories/userRepository.js"
import type { UserId } from "../../db/repositories.js"
import type { UserAccountState } from "../../db/types.js"
import type { InvestmentRecordedMailDeps } from "../email/investmentRecordedMail.js"
import {
  recordingCategoryOf,
  recordingNoticeOf,
  type AssignedRecordingCategory,
  type RecordingCategory,
  type RecordingReasonCode,
} from "../shared/recordingCategory.js"
import { refuseErasedClient } from "../shared/erasedClient.js"
import { queueRecordingMail } from "./recordingMail.js"
import { commitSipMonthLink, prepareSipMonthLink, type SipMonthLinkInput } from "./sipMonthLink.js"

export interface RecordContributionDeps extends InvestmentRecordedMailDeps {
  readonly clientPositionRepository: ClientPositionRepository
  readonly clientGrowthRepository: ClientGrowthRepository
  readonly userRepository: UserWriteRepository
  readonly auditRepository: AuditWriteRepository
  readonly notificationRepository: NotificationWriteRepository
  readonly sipScheduleRepository: AdminSipScheduleRepository
  readonly recordingCategoryRepository: Pick<RecordingCategoryRepository, "insertOneTime">
  readonly clock: () => Date
}

export interface RecordContributionInput {
  readonly userId: string
  readonly fundId: string
  readonly amountPaise: bigint
  readonly effectiveDate: string
  readonly reasonCode: RecordingReasonCode
  readonly note: string | null
  readonly sipLink?: SipMonthLinkInput | null
  readonly assignedCategory?: AssignedRecordingCategory | null
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

const refuseField = (field: string, message: string): AppError =>
  new AppError("VALIDATION_FAILED", { fields: { [field]: [message] } })

const refuseInconsistentCategory = (
  category: RecordingCategory,
  assigned: AssignedRecordingCategory | null,
  hasLink: boolean,
): void => {
  if (assigned === null) return
  if (category === "correction") {
    throw refuseField("category", "a correction is neither a SIP payment nor a one-time investment")
  }
  if (assigned === "sip" && !hasLink) throw refuseField("sipScheduleLink", "is required for a SIP payment")
  if (assigned === "one_time" && hasLink) {
    throw refuseField("sipScheduleLink", "must be left out for a one-time investment")
  }
}

const canReceiveMail = (user: User): boolean => user.account_state === "active" && user.pii_tombstoned_at === null

const midday = (effectiveDate: string): Date => new Date(`${effectiveDate}T12:00:00.000Z`)

export const requireRecordableClient = async (
  tx: Transaction,
  deps: Pick<RecordContributionDeps, "userRepository">,
  userId: UserId,
): Promise<User> => {
  const user = await deps.userRepository.lockById(tx, userId)
  if (user === null) throw new AppError("RESOURCE_NOT_FOUND")
  refuseErasedClient(user.pii_tombstoned_at)
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
  const requestedLink = input.sipLink ?? null
  const assigned = input.assignedCategory ?? null
  refuseInconsistentCategory(category, assigned, requestedLink !== null)
  await deps.clientGrowthRepository.lockPosition(tx, input.userId, input.fundId)
  const client = await requireRecordableClient(tx, deps, input.userId as UserId)

  const version = await deps.clientPositionRepository.findFundVersionForDate(tx, {
    fundId: input.fundId,
    effectiveDate: input.effectiveDate,
  })
  if (version === null) throw new AppError("RESOURCE_NOT_FOUND")

  const sipLink =
    requestedLink === null
      ? null
      : await prepareSipMonthLink(tx, deps, {
          userId: input.userId,
          fundId: input.fundId,
          category,
          link: requestedLink,
        })

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
  if (sipLink !== null) {
    await commitSipMonthLink(tx, deps, sipLink, {
      entryId: entry.id,
      actorUserId: input.actorUserId,
      requestId: input.requestId,
    })
  }
  if (assigned === "one_time") {
    await deps.recordingCategoryRepository.insertOneTime(tx, {
      entryId: entry.id,
      userId: input.userId,
      fundId: input.fundId,
      actorUserId: input.actorUserId,
      requestId: input.requestId,
    })
  }

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
      assignedCategory: sipLink === null ? assigned : "sip",
      fundVersionId: version.fundVersionId,
      fundVersionEffectiveOnDate: version.historical,
      paymentAttemptCreated: false,
    },
  })

  const notice = recordingNoticeOf({
    reasonCode: input.reasonCode,
    assigned: sipLink === null ? assigned : "sip",
    sipMonth: sipLink?.month ?? null,
    fundName: version.fundName,
  })
  await deps.notificationRepository.create(tx, {
    userId: input.userId,
    kind: RECORDED_CONTRIBUTION_NOTIFICATION.kind,
    title: notice.title,
    body: notice.body,
    payload: {
      fundId: input.fundId,
      deepLink: RECORDED_CONTRIBUTION_NOTIFICATION.deepLink,
      entryId: entry.id,
      orderId: order.id,
      category,
    },
  })

  if (canReceiveMail(client)) {
    await queueRecordingMail(tx, deps, {
      recipient: client,
      entryId: entry.id,
      fundName: version.fundName,
      amountPaise: input.amountPaise,
      effectiveDate: input.effectiveDate,
      requestId: input.requestId,
      category,
      assignedCategory: assigned,
      sipLink,
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
