import type { Transaction, UserId } from "../../db/repositories.js"
import { AppError } from "../../http/errorCatalog.js"
import type { NotificationWriteRepository } from "../../repositories/notificationRepository.js"
import type { NomineeRequestRepository, NomineeRequestRow } from "../../repositories/nomineeRequestRepository.js"
import type { NomineeHolder } from "../../repositories/userNomineeRepository.js"
import type { UserWriteRepository } from "../../repositories/userRepository.js"
import { changeClientNominee, type AdminNomineeDeps } from "../client/nominee.js"
import { NOMINEE_REQUEST_ENTITY, REQUEST_STALE_MESSAGE, requirePendingVersion } from "../client/nomineeRequests.js"
import { queueNomineeRequestDecidedMail, type NomineeRequestDecidedMailDeps } from "../email/nomineeRequestDecidedMail.js"

export const NOMINEE_REQUEST_NOTIFICATION_KIND = "nominee_request_decided"
export const NOMINEE_REQUEST_DEEP_LINK = "/profile"

type Decision = "accepted" | "declined"

export interface NomineeDecisionDeps
  extends Omit<AdminNomineeDeps, "userRepository">,
    Omit<NomineeRequestDecidedMailDeps, "config"> {
  readonly nomineeRequestRepository: NomineeRequestRepository
  readonly notificationRepository: Pick<NotificationWriteRepository, "create">
  readonly userRepository: Pick<UserWriteRepository, "findActiveRolesAndPermissions" | "findById">
  readonly config: Readonly<{ sesConfigurationSet: string }>
}

interface DecisionBase {
  readonly nomineeRequestId: string
  readonly expectedVersion: number
  readonly actorUserId: string
  readonly requestId: string
}

export interface AcceptNomineeRequestCommand extends DecisionBase {
  readonly expectedNomineeVersion: number
}

export interface DeclineNomineeRequestCommand extends DecisionBase {
  readonly reason: string | null
}

export interface NomineeDecision {
  readonly request: NomineeRequestRow
  readonly holder: NomineeHolder
}

const NOTIFICATION_COPY: Readonly<Record<Decision, Readonly<{ title: string; body: string }>>> = {
  accepted: {
    title: "Nominee request accepted",
    body: "The BeOnEdge team accepted your nominee request. Your Profile shows the updated nominee.",
  },
  declined: {
    title: "Nominee request declined",
    body: "The BeOnEdge team declined your nominee request, so your nominee has not changed. Open Profile for details.",
  },
}

const lockPending = async (
  tx: Transaction,
  deps: NomineeDecisionDeps,
  command: DecisionBase,
): Promise<Readonly<{ current: NomineeRequestRow; holder: NomineeHolder }>> => {
  const seen = await deps.nomineeRequestRepository.find(tx, command.nomineeRequestId)
  if (seen === null) throw new AppError("RESOURCE_NOT_FOUND")
  const holder = await deps.userNomineeRepository.lock(tx, seen.userId)
  const current = await deps.nomineeRequestRepository.lock(tx, command.nomineeRequestId)
  if (holder === null || current === null) throw new AppError("RESOURCE_NOT_FOUND")
  requirePendingVersion(current, command.expectedVersion)
  return { current, holder }
}

const close = async (
  tx: Transaction,
  deps: NomineeDecisionDeps,
  command: DecisionBase,
  decision: Readonly<{ state: Decision; reason: string | null }>,
): Promise<NomineeRequestRow> => {
  const closed = await deps.nomineeRequestRepository.close(tx, {
    requestId: command.nomineeRequestId,
    expectedVersion: command.expectedVersion,
    state: decision.state,
    declineReason: decision.reason,
    decidedByUserId: command.actorUserId,
    now: deps.clock(),
  })
  if (closed === null) throw new AppError("STATE_CONFLICT", { message: REQUEST_STALE_MESSAGE })
  return closed
}

const informClient = async (
  tx: Transaction,
  deps: NomineeDecisionDeps,
  request: NomineeRequestRow,
  decision: Decision,
  requestId: string,
): Promise<void> => {
  await deps.notificationRepository.create(tx, {
    userId: request.userId,
    kind: NOMINEE_REQUEST_NOTIFICATION_KIND,
    title: NOTIFICATION_COPY[decision].title,
    body: NOTIFICATION_COPY[decision].body,
    payload: { nomineeRequestId: request.id, decision, deepLink: NOMINEE_REQUEST_DEEP_LINK },
  })
  const client = await deps.userRepository.findById(tx, request.userId as UserId)
  if (client?.account_state !== "active" || client.pii_tombstoned_at !== null) return
  await queueNomineeRequestDecidedMail(tx, deps, {
    recipient: client,
    nomineeRequestId: request.id,
    decision,
    requestId,
  })
}

const auditDecision = (
  tx: Transaction,
  deps: NomineeDecisionDeps,
  command: DecisionBase,
  closed: NomineeRequestRow,
  metadata: Readonly<Record<string, unknown>>,
) =>
  deps.auditRepository.append(tx, {
    actorType: "admin",
    actorUserId: command.actorUserId,
    command: `nominee_request.${closed.state}`,
    entityType: NOMINEE_REQUEST_ENTITY,
    entityId: closed.id,
    fromState: "pending",
    toState: closed.state,
    requestId: command.requestId,
    entityVersion: Number(closed.version),
    metadata: { userId: closed.userId, ...metadata },
  })

export const acceptNomineeRequest = async (
  tx: Transaction,
  deps: NomineeDecisionDeps,
  command: AcceptNomineeRequestCommand,
): Promise<NomineeDecision> => {
  const { current } = await lockPending(tx, deps, command)
  const change = await changeClientNominee(tx, deps, {
    userId: current.userId,
    nominee: { name: current.nomineeName, relation: current.nomineeRelation },
    expectedVersion: command.expectedNomineeVersion,
    actorUserId: command.actorUserId,
    requestId: command.requestId,
  })
  const closed = await close(tx, deps, command, { state: "accepted", reason: null })
  await auditDecision(tx, deps, command, closed, {
    nomineeChanged: change.status === "changed",
    nomineeVersion: change.holder.version,
  })
  await informClient(tx, deps, closed, "accepted", command.requestId)
  return { request: closed, holder: change.holder }
}

export const declineNomineeRequest = async (
  tx: Transaction,
  deps: NomineeDecisionDeps,
  command: DeclineNomineeRequestCommand,
): Promise<NomineeDecision> => {
  const { holder } = await lockPending(tx, deps, command)
  const closed = await close(tx, deps, command, { state: "declined", reason: command.reason })
  await auditDecision(tx, deps, command, closed, { withReason: command.reason !== null })
  await informClient(tx, deps, closed, "declined", command.requestId)
  return { request: closed, holder }
}
