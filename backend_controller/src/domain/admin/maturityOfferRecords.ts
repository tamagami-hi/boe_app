import type { Transaction } from "../../db/repositories.js"
import { AppError } from "../../http/errorCatalog.js"
import type { AuditWriteRepository } from "../../repositories/auditRepository.js"
import type {
  ClientMaturityOfferRepository,
  ClosedOfferState,
  LockedMaturityOffer,
} from "../../repositories/clientMaturityOfferRepository.js"

export interface MaturityOfferRecordDeps {
  readonly maturityOfferRepository: ClientMaturityOfferRepository
  readonly auditRepository: AuditWriteRepository
  readonly clock: () => Date
}

export interface OfferCloseInput {
  readonly state: ClosedOfferState
  readonly actorUserId: string
  readonly requestId: string
}

export const OFFER_ENTITY_TYPE = "client_maturity_offer"
export const STALE_OFFER_MESSAGE = "These options changed since you opened them. Reload and try again."

export const offerAuditMetadata = (offer: LockedMaturityOffer): Readonly<Record<string, unknown>> => ({
  userId: offer.userId,
  fundId: offer.fundId,
  scheduleId: offer.maturityScheduleId,
  chosenOption: offer.chosenOption,
})

export const closeMaturityOffer = async (
  tx: Transaction,
  deps: MaturityOfferRecordDeps,
  offer: LockedMaturityOffer,
  input: OfferCloseInput,
): Promise<void> => {
  const closed = await deps.maturityOfferRepository.close(tx, {
    offerId: offer.id,
    expectedVersion: offer.version,
    state: input.state,
    actorUserId: input.actorUserId,
    now: deps.clock(),
  })
  if (!closed) throw new AppError("STATE_CONFLICT", { message: STALE_OFFER_MESSAGE })
  await deps.auditRepository.append(tx, {
    actorType: "admin",
    actorUserId: input.actorUserId,
    command: `${OFFER_ENTITY_TYPE}.${input.state}`,
    entityType: OFFER_ENTITY_TYPE,
    entityId: offer.id,
    fromState: offer.state,
    toState: input.state,
    requestId: input.requestId,
    entityVersion: Number(offer.version) + 1,
    metadata: offerAuditMetadata(offer),
  })
}

export const closeOpenOfferIfAny = async (
  tx: Transaction,
  deps: MaturityOfferRecordDeps,
  offer: LockedMaturityOffer | null,
  input: OfferCloseInput,
): Promise<void> => {
  if (offer !== null) await closeMaturityOffer(tx, deps, offer, input)
}
