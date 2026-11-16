import type { Transaction, UserId } from "../../db/repositories.js"
import { AppError } from "../../http/errorCatalog.js"
import type { AuditWriteRepository } from "../../repositories/auditRepository.js"
import type { NomineeRequestRepository, NomineeRequestRow } from "../../repositories/nomineeRequestRepository.js"
import type { Nominee, UserNomineeRepository } from "../../repositories/userNomineeRepository.js"
import { passwordMatches, type ContactDetailsDeps } from "./contactDetails.js"
import { maskNomineeName, sameNominee } from "./nominee.js"

export const NOMINEE_REQUEST_ENTITY = "client_nominee_request"
export const PENDING_REQUEST_EXISTS_MESSAGE =
  "A nominee request is already waiting for the BeOnEdge team. Withdraw it before sending another."
export const REQUEST_CLOSED_MESSAGE = "This nominee request has already been decided or withdrawn. Reload to see it."
export const REQUEST_STALE_MESSAGE = "This nominee request changed since you opened it. Reload it and try again."
export const ALREADY_NOMINEE_MESSAGE = "This is already the nominee on your account."

export interface NomineeRequestDeps {
  readonly nomineeRequestRepository: NomineeRequestRepository
  readonly userNomineeRepository: Pick<UserNomineeRepository, "lock">
  readonly auditRepository: AuditWriteRepository
  readonly clock: () => Date
}

export type SendNomineeRequestDeps = NomineeRequestDeps & Pick<ContactDetailsDeps, "credentialRepository" | "userRepository">

export interface SendNomineeRequestInput {
  readonly userId: string
  readonly nominee: Nominee
  readonly currentPassword: string
  readonly requestId: string
}

export interface WithdrawNomineeRequestInput {
  readonly userId: string
  readonly nomineeRequestId: string
  readonly expectedVersion: number
  readonly requestId: string
}

const conflict = (message: string): AppError => new AppError("STATE_CONFLICT", { message })

export const requirePendingVersion = (current: NomineeRequestRow, expectedVersion: number): void => {
  if (current.state !== "pending") throw conflict(REQUEST_CLOSED_MESSAGE)
  if (Number(current.version) !== expectedVersion) throw conflict(REQUEST_STALE_MESSAGE)
}

export const readLatestNomineeRequest = (
  tx: Transaction,
  deps: Pick<NomineeRequestDeps, "nomineeRequestRepository">,
  userId: string,
): Promise<NomineeRequestRow | null> => deps.nomineeRequestRepository.findLatestForUser(tx, userId)

export const sendNomineeRequest = async (
  tx: Transaction,
  deps: SendNomineeRequestDeps,
  input: SendNomineeRequestInput,
): Promise<NomineeRequestRow> => {
  const holder = await deps.userNomineeRepository.lock(tx, input.userId)
  if (holder === null) throw new AppError("RESOURCE_NOT_FOUND")
  if (holder.accountState !== "active" || holder.tombstoned) throw new AppError("ACCOUNT_NOT_ACTIVE")
  if (!(await passwordMatches(tx, deps, input.userId as UserId, input.currentPassword))) {
    throw new AppError("INVALID_CREDENTIALS")
  }
  if (sameNominee(holder.nominee, input.nominee)) {
    throw new AppError("VALIDATION_FAILED", { fields: { name: [ALREADY_NOMINEE_MESSAGE] } })
  }
  const repository = deps.nomineeRequestRepository
  if ((await repository.findPendingForUser(tx, input.userId)) !== null) throw conflict(PENDING_REQUEST_EXISTS_MESSAGE)
  const created = await repository.insertPending(tx, { userId: input.userId, nominee: input.nominee, now: deps.clock() })
  if (created === null) throw conflict(PENDING_REQUEST_EXISTS_MESSAGE)

  await deps.auditRepository.append(tx, {
    actorType: "user",
    actorUserId: input.userId,
    command: "nominee_request.sent",
    entityType: NOMINEE_REQUEST_ENTITY,
    entityId: created.id,
    toState: created.state,
    requestId: input.requestId,
    entityVersion: Number(created.version),
    metadata: {
      userId: input.userId,
      requestedName: maskNomineeName(created.nomineeName),
      replacesNominee: holder.nominee !== null,
    },
  })
  return created
}

export const withdrawNomineeRequest = async (
  tx: Transaction,
  deps: NomineeRequestDeps,
  input: WithdrawNomineeRequestInput,
): Promise<NomineeRequestRow> => {
  if ((await deps.userNomineeRepository.lock(tx, input.userId)) === null) throw new AppError("RESOURCE_NOT_FOUND")
  const current = await deps.nomineeRequestRepository.lock(tx, input.nomineeRequestId)
  if (current === null || current.userId !== input.userId) throw new AppError("RESOURCE_NOT_FOUND")
  requirePendingVersion(current, input.expectedVersion)

  const closed = await deps.nomineeRequestRepository.close(tx, {
    requestId: current.id,
    expectedVersion: input.expectedVersion,
    state: "withdrawn",
    declineReason: null,
    decidedByUserId: null,
    now: deps.clock(),
  })
  if (closed === null) throw conflict(REQUEST_STALE_MESSAGE)

  await deps.auditRepository.append(tx, {
    actorType: "user",
    actorUserId: input.userId,
    command: "nominee_request.withdrawn",
    entityType: NOMINEE_REQUEST_ENTITY,
    entityId: closed.id,
    fromState: current.state,
    toState: closed.state,
    requestId: input.requestId,
    entityVersion: Number(closed.version),
    metadata: { userId: input.userId },
  })
  return closed
}
