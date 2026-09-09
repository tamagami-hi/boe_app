import type { Transaction, UserId } from "../../db/repositories.js"
import { AppError } from "../../http/errorCatalog.js"
import type { AuditWriteRepository } from "../../repositories/auditRepository.js"
import type { ClientGrowthRepository } from "../../repositories/clientGrowthRepository.js"
import type {
  ClientPositionRepository,
  LedgerEntryRow,
  ReversalPositionBasis,
} from "../../repositories/clientPositionRepository.js"
import type { NotificationWriteRepository } from "../../repositories/notificationRepository.js"
import type { UserWriteRepository } from "../../repositories/userRepository.js"

export interface ReverseLedgerEntryDeps {
  readonly clientPositionRepository: ClientPositionRepository
  readonly clientGrowthRepository: ClientGrowthRepository
  readonly userRepository: UserWriteRepository
  readonly auditRepository: AuditWriteRepository
  readonly notificationRepository: NotificationWriteRepository
}

export interface ReverseLedgerEntryInput {
  readonly userId: string
  readonly entryId: string
  readonly reasonCode: string
  readonly note: string | null
  readonly actorUserId: string
  readonly requestId: string
}

export interface ReversedLedgerEntry {
  readonly reversalEntryId: string
  readonly reversedEntryId: string
  readonly fundId: string
  readonly effectiveDate: string
  readonly principalDeltaPaise: bigint
  readonly valueDeltaPaise: bigint
  readonly principalPaise: bigint
  readonly currentValuePaise: bigint
}

export const REVERSAL_NOTIFICATION = Object.freeze({
  kind: "client_value_updated",
  title: "Investment value updated",
  body: "The value of one of your investments was updated. Open your portfolio to see the current value.",
})

export const reverseLedgerEntry = async (
  tx: Transaction,
  deps: ReverseLedgerEntryDeps,
  input: ReverseLedgerEntryInput,
): Promise<ReversedLedgerEntry> => {
  const preview = await deps.clientPositionRepository.findEntryIdentity(tx, {
    userId: input.userId,
    entryId: input.entryId,
  })
  if (preview === null) throw new AppError("RESOURCE_NOT_FOUND")

  await deps.clientGrowthRepository.lockPosition(tx, input.userId, preview.fundId)

  const user = await deps.userRepository.lockById(tx, input.userId as UserId)
  if (user === null) throw new AppError("RESOURCE_NOT_FOUND")

  const original = await deps.clientPositionRepository.lockEntryForReversal(tx, {
    userId: input.userId,
    entryId: input.entryId,
  })
  if (original === null) throw new AppError("RESOURCE_NOT_FOUND")

  assertReversible(original)

  const before = await deps.clientPositionRepository.findReversalBasis(tx, {
    userId: input.userId,
    fundId: original.fundId,
    effectiveDate: original.effectiveDate,
  })
  const after = deriveReversedPosition(before, original)

  const reversal = await deps.clientPositionRepository.insertReversalEntry(tx, {
    original,
    reasonCode: input.reasonCode,
    note: input.note,
    actorUserId: input.actorUserId,
    requestId: input.requestId,
  })

  await recordReversalOutcome(tx, deps, input, original, reversal.id)

  return {
    reversalEntryId: reversal.id,
    reversedEntryId: original.id,
    fundId: original.fundId,
    effectiveDate: original.effectiveDate,
    principalDeltaPaise: -original.principalDeltaPaise,
    valueDeltaPaise: -original.valueDeltaPaise,
    principalPaise: after.principalPaise,
    currentValuePaise: after.currentValuePaise,
  }
}

const recordReversalOutcome = async (
  tx: Transaction,
  deps: ReverseLedgerEntryDeps,
  input: ReverseLedgerEntryInput,
  original: LedgerEntryRow,
  reversalEntryId: string,
): Promise<void> => {
  await deps.auditRepository.append(tx, {
    actorType: "admin",
    actorUserId: input.actorUserId,
    command: "client_position.entry_reversed",
    entityType: "client_value_entry",
    entityId: reversalEntryId,
    toState: "reversal",
    requestId: input.requestId,
    entityVersion: 1,
    metadata: {
      userId: input.userId,
      fundId: original.fundId,
      reversedEntryId: original.id,
      reversedEntryType: original.entryType,
      effectiveDate: original.effectiveDate,
      principalDeltaPaise: (-original.principalDeltaPaise).toString(),
      valueDeltaPaise: (-original.valueDeltaPaise).toString(),
      reasonCode: input.reasonCode,
    },
  })

  await deps.notificationRepository.create(tx, {
    userId: input.userId,
    kind: REVERSAL_NOTIFICATION.kind,
    title: REVERSAL_NOTIFICATION.title,
    body: REVERSAL_NOTIFICATION.body,
    payload: { fundId: original.fundId },
  })

}

const deriveReversedPosition = (
  before: ReversalPositionBasis,
  original: LedgerEntryRow,
): Readonly<{ principalPaise: bigint; currentValuePaise: bigint }> => {
  const principalPaise = before.principalPaise - original.principalDeltaPaise
  const currentValuePaise = before.currentValuePaise - original.valueDeltaPaise
  if (principalPaise < 0n || currentValuePaise < 0n) {
    throw new AppError("STATE_CONFLICT", {
      message: "Reverse the dependent entries first; this correction would make the position negative.",
    })
  }
  if (
    before.minimumPrincipalPaise - original.principalDeltaPaise < 0n ||
    before.minimumValuePaise - original.valueDeltaPaise < 0n
  ) {
    throw new AppError("STATE_CONFLICT", {
      message: "Reverse the dependent entries first; this correction would make a historical position balance negative.",
    })
  }
  if (
    original.entryType === "contribution" &&
    before.contributionCount === 1n &&
    (principalPaise !== 0n || currentValuePaise !== 0n)
  ) {
    throw new AppError("STATE_CONFLICT", {
      message: "Reverse the dependent entries before removing the position's last contribution.",
    })
  }
  return { principalPaise, currentValuePaise }
}

const assertReversible = (original: LedgerEntryRow): void => {
  if (original.entryType === "reversal") {
    throw new AppError("STATE_CONFLICT", {
      message: "A reversal cannot itself be reversed. Append the correct entry instead.",
    })
  }
  if (original.reversedByEntryId !== null) {
    throw new AppError("STATE_CONFLICT", {
      message: "That entry has already been reversed.",
    })
  }
}
