import type { Transaction } from "../../db/repositories.js"
import type { ClientMaturityOption } from "../../db/types.js"
import { AppError } from "../../http/errorCatalog.js"
import type { AuditWriteRepository } from "../../repositories/auditRepository.js"
import type { ClientMaturityOfferRepository, MaturityOfferRow } from "../../repositories/clientMaturityOfferRepository.js"

export interface MaturityChoiceDeps {
  readonly maturityOfferRepository: ClientMaturityOfferRepository
  readonly auditRepository: AuditWriteRepository
  readonly clock: () => Date
}

export interface ChooseMaturityOptionCommand {
  readonly userId: string
  readonly offerId: string
  readonly option: ClientMaturityOption
  readonly expectedVersion: number
  readonly requestId: string
}

const CLOSED_MESSAGE = "These options are no longer open. The BeOnEdge team may have sent new ones or already confirmed your choice."
const STALE_MESSAGE = "These options changed since you opened them. Check them again before choosing."

export const chooseMaturityOption = async (
  tx: Transaction,
  deps: MaturityChoiceDeps,
  command: ChooseMaturityOptionCommand,
): Promise<MaturityOfferRow> => {
  const offer = await deps.maturityOfferRepository.lockById(tx, command.offerId)
  if (offer === null || offer.userId !== command.userId) throw new AppError("RESOURCE_NOT_FOUND")
  if (offer.state !== "open") throw new AppError("STATE_CONFLICT", { message: CLOSED_MESSAGE })
  if (Number(offer.version) !== command.expectedVersion) throw new AppError("STATE_CONFLICT", { message: STALE_MESSAGE })
  if (command.option === "sip_extension" && offer.extensionMonths === null) {
    throw new AppError("VALIDATION_FAILED", { fields: { option: ["was not offered"] } })
  }
  if (offer.chosenOption === command.option) {
    throw new AppError("VALIDATION_FAILED", { fields: { option: ["is already your choice"] } })
  }

  const now = deps.clock()
  const chosen = await deps.maturityOfferRepository.choose(tx, {
    offerId: offer.id,
    expectedVersion: offer.version,
    option: command.option,
    now,
  })
  if (!chosen) throw new AppError("STATE_CONFLICT", { message: STALE_MESSAGE })
  await deps.auditRepository.append(tx, {
    actorType: "user",
    actorUserId: command.userId,
    command: "client_maturity_offer.chosen",
    entityType: "client_maturity_offer",
    entityId: offer.id,
    fromState: offer.state,
    toState: offer.state,
    requestId: command.requestId,
    entityVersion: Number(offer.version) + 1,
    metadata: {
      userId: offer.userId,
      fundId: offer.fundId,
      scheduleId: offer.maturityScheduleId,
      option: command.option,
      previousOption: offer.chosenOption,
    },
  })
  const row = await deps.maturityOfferRepository.findForUser(tx, { userId: command.userId, offerId: offer.id })
  if (row === null) throw new AppError("INTERNAL_ERROR")
  return row
}
