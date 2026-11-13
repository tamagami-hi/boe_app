import { z } from "zod"

import { createSuccessEnvelopeSchema } from "../envelope.js"
import { IsoDateTime, Uuid } from "../scalars.js"
import {
  ADMIN_PAGED_READ_ERRORS,
  ADMIN_READ_ERRORS,
  ADMIN_WRITE_ERRORS,
  AdminCursor,
  AdminLimit,
  AdminPageMeta,
  RequiredAdminMutationHeaders,
} from "./admin-shared.js"
import { SupportRequestState } from "./client-account.js"
import { defineOperation, MAX_JSON_BODY_BYTES } from "./descriptor.js"

export const MAX_SUPPORT_RESOLUTION_NOTE_LENGTH = 2_000

export const AdminSupportTicket = z.strictObject({
  id: Uuid,
  userId: Uuid,
  clientName: z.string(),
  reference: z.string(),
  category: z.string(),
  subject: z.string(),
  status: SupportRequestState,
  resolvedAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  version: z.number().int().positive(),
})
export type AdminSupportTicket = z.infer<typeof AdminSupportTicket>

export const AdminSupportTicketEvent = z.strictObject({
  id: Uuid,
  command: z.string(),
  actorType: z.string(),
  actorName: z.string().nullable(),
  fromState: z.string().nullable(),
  toState: z.string().nullable(),
  noteChanged: z.boolean(),
  occurredAt: IsoDateTime,
})
export type AdminSupportTicketEvent = z.infer<typeof AdminSupportTicketEvent>

export const AdminSupportTicketDetail = AdminSupportTicket.extend({
  body: z.string(),
  resolutionNote: z.string().nullable(),
  closedAt: IsoDateTime.nullable(),
  history: z.array(AdminSupportTicketEvent),
})
export type AdminSupportTicketDetail = z.infer<typeof AdminSupportTicketDetail>

const AdminSupportTicketPage = createSuccessEnvelopeSchema(
  z.strictObject({ items: z.array(AdminSupportTicket) }),
  { page: AdminPageMeta },
)

export const AdminSupportInboxQuery = z.strictObject({
  after: AdminCursor,
  limit: AdminLimit,
  status: SupportRequestState.optional(),
})

export const listAdminSupportTickets = defineOperation({
  operationId: "listAdminSupportTickets",
  method: "GET",
  path: "/v1/admin/support/tickets",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: { query: AdminSupportInboxQuery },
  success: { status: 200, schema: AdminSupportTicketPage },
  errorCodes: [...ADMIN_PAGED_READ_ERRORS],
})

const TicketId = z.strictObject({ ticketId: Uuid })

export const getAdminSupportTicket = defineOperation({
  operationId: "getAdminSupportTicket",
  method: "GET",
  path: "/v1/admin/support/tickets/{ticketId}",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: { params: TicketId },
  success: { status: 200, schema: createSuccessEnvelopeSchema(AdminSupportTicketDetail) },
  errorCodes: [...ADMIN_READ_ERRORS, "RESOURCE_NOT_FOUND"],
})

export const AdminSupportResponseBody = z.strictObject({
  status: SupportRequestState,
  resolutionNote: z.string().trim().min(1).max(MAX_SUPPORT_RESOLUTION_NOTE_LENGTH),
  expectedVersion: z.number().int().positive(),
})
export type AdminSupportResponseBody = z.infer<typeof AdminSupportResponseBody>

export const respondToAdminSupportTicket = defineOperation({
  operationId: "respondToAdminSupportTicket",
  method: "POST",
  path: "/v1/admin/support/tickets/{ticketId}/responses",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "required-key",
  request: {
    params: TicketId,
    body: AdminSupportResponseBody,
    headers: RequiredAdminMutationHeaders,
    mediaType: "application/json",
    maxBodyBytes: MAX_JSON_BODY_BYTES,
  },
  success: { status: 200, schema: createSuccessEnvelopeSchema(AdminSupportTicketDetail) },
  errorCodes: [...ADMIN_WRITE_ERRORS, "RESOURCE_NOT_FOUND", "STATE_CONFLICT"],
})

export const AdminUserSupportTicketsQuery = z.strictObject({
  after: AdminCursor,
  limit: AdminLimit,
})

export const listAdminUserSupportTickets = defineOperation({
  operationId: "listAdminUserSupportTickets",
  method: "GET",
  path: "/v1/admin/users/{userId}/support-tickets",
  authChannel: "admin-web",
  credentialPolicy: "admin-session-cookie-and-csrf",
  idempotency: "none",
  request: { params: z.strictObject({ userId: Uuid }), query: AdminUserSupportTicketsQuery },
  success: { status: 200, schema: AdminSupportTicketPage },
  errorCodes: [...ADMIN_PAGED_READ_ERRORS, "RESOURCE_NOT_FOUND"],
})

export const ADMIN_SUPPORT_OPERATIONS = Object.freeze([
  listAdminSupportTickets,
  getAdminSupportTicket,
  respondToAdminSupportTicket,
  listAdminUserSupportTickets,
])
