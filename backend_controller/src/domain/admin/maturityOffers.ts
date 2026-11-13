import type { Transaction, User, UserId } from "../../db/repositories.js"
import type { ClientMaturityOption } from "../../db/types.js"
import { formatCalendarDate } from "../../email/emailMoney.js"
import { AppError } from "../../http/errorCatalog.js"
import type { LockedMaturityOffer, MaturityOfferRow } from "../../repositories/clientMaturityOfferRepository.js"
import type { LockedMaturitySchedule, MaturityScheduleRow } from "../../repositories/clientMaturityScheduleRepository.js"
import type { NotificationWriteRepository } from "../../repositories/notificationRepository.js"
import { queueMaturityOptionsMail, type MaturityOptionsMailDeps } from "../email/maturityOptionsMail.js"
import { findActiveSip, refuseInvalidExtension, type SipExtension } from "./maturityExtension.js"
import {
  closeMaturityOffer,
  closeOpenOfferIfAny,
  OFFER_ENTITY_TYPE,
  STALE_OFFER_MESSAGE,
} from "./maturityOfferRecords.js"
import {
  refuseEarlyStartMonth,
  resolveLockedMaturity,
  type FollowUpSchedule,
  type MaturityResolutionDeps,
  type MaturityResolutionOutcome,
  type ResolveMaturityCommand,
} from "./maturityResolutions.js"
import { loadMaturitySchedule, lockOpenMaturitySchedule, type OwnScheduleCommand } from "./maturitySchedules.js"

export const MATURITY_OPTIONS_NOTIFICATION_KIND = "maturity_options_sent"

export type MaturityOfferDeps = MaturityResolutionDeps &
  MaturityOptionsMailDeps &
  Readonly<{ notificationRepository: NotificationWriteRepository }>

export interface SendMaturityOptionsCommand extends OwnScheduleCommand {
  readonly offerVersion: number | null
  readonly sip: FollowUpSchedule
  readonly extension: SipExtension | null
}

export interface OwnOfferCommand extends OwnScheduleCommand {
  readonly offerId: string
  readonly offerVersion: number
}

export type ConfirmMaturityOfferCommand = OwnOfferCommand &
  (
    | Readonly<{ option: "return_all"; effectiveDate: string; amountPaise: bigint }>
    | Readonly<{
        option: "one_time_and_sip"
        effectiveDate: string
        expectedPrincipalPaise: bigint
        expectedCurrentValuePaise: bigint
      }>
    | Readonly<{ option: "sip_extension" }>
  )

export interface SentMaturityOptions {
  readonly schedule: MaturityScheduleRow
  readonly offer: MaturityOfferRow
}

const INACTIVE_CLIENT_MESSAGE = "Options can only be sent to an active client account."
const NO_HOLDING_MESSAGE = "This client no longer holds anything in this fund."
const CLOSED_OFFER_MESSAGE = "These options are no longer open. Reload to see the latest."
const NOT_CHOSEN_MESSAGE = "The client has not chosen an option yet."
const CHOICE_CHANGED_MESSAGE = "The client's choice changed since you opened it. Reload and review it again."
const OFFER_CHANGED_MESSAGE = "The options for this maturity changed since you opened it. Reload and review them before sending."

const refuseChangedOffer = (open: LockedMaturityOffer | null, expectedVersion: number | null): void => {
  const current = open === null ? null : Number(open.version)
  if (current !== expectedVersion) throw new AppError("STATE_CONFLICT", { message: OFFER_CHANGED_MESSAGE })
}

const requireActiveClient = async (tx: Transaction, deps: MaturityOfferDeps, userId: string): Promise<User> => {
  const user = await deps.userRepository.lockById(tx, userId as UserId)
  if (user === null) throw new AppError("RESOURCE_NOT_FOUND")
  if (user.account_state !== "active" || user.pii_tombstoned_at !== null) {
    throw new AppError("STATE_CONFLICT", { message: INACTIVE_CLIENT_MESSAGE })
  }
  return user
}

const refuseInvalidFigures = async (
  tx: Transaction,
  deps: MaturityOfferDeps,
  schedule: LockedMaturitySchedule,
  command: SendMaturityOptionsCommand,
): Promise<void> => {
  refuseEarlyStartMonth(schedule, command.sip, deps.clock())
  if (command.extension !== null) {
    refuseInvalidExtension(schedule, command.extension, await findActiveSip(tx, deps, schedule))
  }
  if ((await deps.clientGrowthRepository.findPositionBasis(tx, schedule.userId, schedule.fundId)) === null) {
    throw new AppError("STATE_CONFLICT", { message: NO_HOLDING_MESSAGE })
  }
}

const loadOffer = async (tx: Transaction, deps: MaturityOfferDeps, userId: string, offerId: string): Promise<MaturityOfferRow> => {
  const offer = await deps.maturityOfferRepository.findForUser(tx, { userId, offerId })
  if (offer === null) throw new AppError("INTERNAL_ERROR")
  return offer
}

const notifyClient = async (
  tx: Transaction,
  deps: MaturityOfferDeps,
  client: User,
  offer: MaturityOfferRow,
  requestId: string,
): Promise<void> => {
  await deps.notificationRepository.create(tx, {
    userId: client.id,
    kind: MATURITY_OPTIONS_NOTIFICATION_KIND,
    title: "Your maturity options are ready",
    body: `Your investment in ${offer.fundName} matures on ${formatCalendarDate(offer.maturityDate)}. Open the app to choose what happens next.`,
    payload: { offerId: offer.id, scheduleId: offer.maturityScheduleId, fundId: offer.fundId },
  })
  await queueMaturityOptionsMail(tx, deps, {
    recipient: client,
    offerId: offer.id,
    fundName: offer.fundName,
    maturityDate: offer.maturityDate,
    requestId,
  })
}

export const sendMaturityOptions = async (
  tx: Transaction,
  deps: MaturityOfferDeps,
  command: SendMaturityOptionsCommand,
): Promise<SentMaturityOptions> => {
  const schedule = await lockOpenMaturitySchedule(tx, deps, command)
  const previous = await deps.maturityOfferRepository.lockOpenForSchedule(tx, schedule.id)
  refuseChangedOffer(previous, command.offerVersion)
  const client = await requireActiveClient(tx, deps, schedule.userId)
  await refuseInvalidFigures(tx, deps, schedule, command)
  await closeOpenOfferIfAny(tx, deps, previous, { ...command, state: "superseded" })

  const inserted = await deps.maturityOfferRepository.insert(tx, {
    scheduleId: schedule.id,
    userId: schedule.userId,
    fundId: schedule.fundId,
    sipMonthlyAmountPaise: command.sip.monthlyAmountPaise.toString(),
    sipStartMonth: command.sip.startMonth,
    sipMonthCount: command.sip.monthCount,
    extensionMonths: command.extension?.months ?? null,
    nextMaturityDate: command.extension?.nextMaturityDate ?? null,
    actorUserId: command.actorUserId,
    requestId: command.requestId,
  })
  const offer = await loadOffer(tx, deps, schedule.userId, inserted.id)
  await deps.auditRepository.append(tx, {
    actorType: "admin",
    actorUserId: command.actorUserId,
    command: `${OFFER_ENTITY_TYPE}.sent`,
    entityType: OFFER_ENTITY_TYPE,
    entityId: offer.id,
    toState: offer.state,
    requestId: command.requestId,
    entityVersion: Number(offer.version),
    metadata: {
      userId: offer.userId,
      fundId: offer.fundId,
      scheduleId: schedule.id,
      supersededOfferId: previous?.id ?? null,
      sip: { monthlyAmountPaise: offer.sipMonthlyAmountPaise, startMonth: offer.sipStartMonth, monthCount: offer.sipMonthCount },
      extension: command.extension,
    },
  })
  await notifyClient(tx, deps, client, offer, command.requestId)
  return { schedule: await loadMaturitySchedule(tx, deps, schedule.userId, schedule.id), offer }
}

const lockOwnOpenOffer = async (
  tx: Transaction,
  deps: MaturityOfferDeps,
  schedule: LockedMaturitySchedule,
  command: OwnOfferCommand,
): Promise<LockedMaturityOffer> => {
  const offer = await deps.maturityOfferRepository.lockById(tx, command.offerId)
  if (offer === null || offer.maturityScheduleId !== schedule.id || offer.userId !== schedule.userId) {
    throw new AppError("RESOURCE_NOT_FOUND")
  }
  if (offer.state !== "open") throw new AppError("STATE_CONFLICT", { message: CLOSED_OFFER_MESSAGE })
  if (Number(offer.version) !== command.offerVersion) throw new AppError("STATE_CONFLICT", { message: STALE_OFFER_MESSAGE })
  return offer
}

export const withdrawMaturityOffer = async (
  tx: Transaction,
  deps: MaturityOfferDeps,
  command: OwnOfferCommand,
): Promise<MaturityScheduleRow> => {
  const schedule = await lockOpenMaturitySchedule(tx, deps, command)
  const offer = await lockOwnOpenOffer(tx, deps, schedule, command)
  await closeMaturityOffer(tx, deps, offer, { ...command, state: "withdrawn" })
  return loadMaturitySchedule(tx, deps, schedule.userId, schedule.id)
}

const resolutionOf = (offer: LockedMaturityOffer, command: ConfirmMaturityOfferCommand): ResolveMaturityCommand => {
  switch (command.option) {
    case "return_all":
      return { ...command, resolution: "return_all" }
    case "one_time_and_sip":
      return {
        ...command,
        resolution: "one_time_and_sip",
        sip: {
          monthlyAmountPaise: BigInt(offer.sipMonthlyAmountPaise),
          startMonth: offer.sipStartMonth,
          monthCount: offer.sipMonthCount,
        },
      }
    case "sip_extension":
      if (offer.extensionMonths === null || offer.nextMaturityDate === null) throw new AppError("INTERNAL_ERROR")
      return {
        ...command,
        resolution: "sip_extension",
        extension: { months: offer.extensionMonths, nextMaturityDate: offer.nextMaturityDate },
      }
  }
}

const refuseUnconfirmableChoice = (offer: LockedMaturityOffer, option: ClientMaturityOption): void => {
  if (offer.chosenOption === null) throw new AppError("STATE_CONFLICT", { message: NOT_CHOSEN_MESSAGE })
  if (offer.chosenOption !== option) throw new AppError("STATE_CONFLICT", { message: CHOICE_CHANGED_MESSAGE })
}

export const confirmMaturityOffer = async (
  tx: Transaction,
  deps: MaturityOfferDeps,
  command: ConfirmMaturityOfferCommand,
): Promise<MaturityResolutionOutcome> => {
  const schedule = await lockOpenMaturitySchedule(tx, deps, command)
  const offer = await lockOwnOpenOffer(tx, deps, schedule, command)
  refuseUnconfirmableChoice(offer, command.option)
  const outcome = await resolveLockedMaturity(tx, deps, schedule, resolutionOf(offer, command))
  await closeMaturityOffer(tx, deps, offer, { ...command, state: "confirmed" })
  return { ...outcome, schedule: await loadMaturitySchedule(tx, deps, schedule.userId, schedule.id) }
}
