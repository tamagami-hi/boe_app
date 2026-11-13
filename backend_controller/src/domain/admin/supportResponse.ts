import type { Transaction } from "../../db/repositories.js"
import type { SupportRequestState } from "../../db/types.js"
import { AppError } from "../../http/errorCatalog.js"
import type { AdminSupportRepository, SupportTicketDetailRow } from "../../repositories/adminSupportRepository.js"
import type { AuditWriteRepository } from "../../repositories/auditRepository.js"
import type { NotificationWriteRepository } from "../../repositories/notificationRepository.js"

export const SUPPORT_UPDATE_NOTIFICATION_KIND = "support_request_updated"
export const CLIENT_SUPPORT_DEEP_LINK = "/profile/support"

const STATE_LABELS: Readonly<Record<SupportRequestState, string>> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
  closed: "Closed",
}

const STALE_MESSAGE = "Someone changed this request since you opened it. Reload it and respond again."

export interface SupportResponseDeps {
  readonly adminSupportRepository: AdminSupportRepository
  readonly auditRepository: AuditWriteRepository
  readonly notificationRepository: NotificationWriteRepository
  readonly clock: () => Date
}

export interface SupportResponseCommand {
  readonly ticketId: string
  readonly expectedVersion: number
  readonly state: SupportRequestState
  readonly resolutionNote: string
  readonly actorUserId: string
  readonly requestId: string
}

const notifyClient = (tx: Transaction, deps: SupportResponseDeps, ticket: SupportTicketDetailRow) =>
  deps.notificationRepository.create(tx, {
    userId: ticket.userId,
    kind: SUPPORT_UPDATE_NOTIFICATION_KIND,
    title: "Support request updated",
    body: `The BeOnEdge team updated your request ${ticket.reference}. Its status is now ${STATE_LABELS[ticket.state]}, and the team's note is on the Support screen.`,
    payload: {
      ticketId: ticket.id,
      reference: ticket.reference,
      status: ticket.state,
      deepLink: CLIENT_SUPPORT_DEEP_LINK,
    },
  })

export const respondToSupportTicket = async (
  tx: Transaction,
  deps: SupportResponseDeps,
  command: SupportResponseCommand,
): Promise<SupportTicketDetailRow> => {
  const current = await deps.adminSupportRepository.lockTicket(tx, command.ticketId)
  if (current === null) throw new AppError("RESOURCE_NOT_FOUND")
  if (Number(current.version) !== command.expectedVersion) {
    throw new AppError("STATE_CONFLICT", { message: STALE_MESSAGE })
  }
  const resolutionNote = command.resolutionNote.trim()
  const noteChanged = resolutionNote !== (current.resolutionNote ?? "")
  if (!noteChanged && current.state === command.state) {
    throw new AppError("VALIDATION_FAILED", {
      fields: { resolutionNote: ["repeats the current status and note; change one of them"] },
    })
  }
  const applied = await deps.adminSupportRepository.applyResponse(tx, {
    ticketId: command.ticketId,
    expectedVersion: command.expectedVersion,
    state: command.state,
    resolutionNote,
    now: deps.clock(),
  })
  const updated = applied ? await deps.adminSupportRepository.findTicket(tx, command.ticketId) : null
  if (updated === null) throw new AppError("STATE_CONFLICT", { message: STALE_MESSAGE })
  await deps.auditRepository.append(tx, {
    actorType: "admin",
    actorUserId: command.actorUserId,
    command: "support.request_responded",
    entityType: "support_request",
    entityId: updated.id,
    fromState: current.state,
    toState: updated.state,
    requestId: command.requestId,
    entityVersion: Number(updated.version),
    metadata: { reference: updated.reference, noteChanged },
  })
  await notifyClient(tx, deps, updated)
  return updated
}
