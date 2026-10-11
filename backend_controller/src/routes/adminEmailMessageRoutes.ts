import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"

import type { UnitOfWork } from "../db/database.js"
import type { IdempotencyRepository } from "../db/repositories.js"
import { requireAnyPermission, resolveAdminPrincipal } from "../domain/admin/adminAccess.js"
import {
  previewAdminEmail,
  sendAdminEmail,
  type AdminEmailMessageDeps,
  type QueuedAdminEmail,
  type SendTarget,
} from "../domain/admin/adminEmailMessages.js"
import type { WebAuthDeps } from "../domain/auth/webAuth.js"
import { parseOrThrow } from "../http/validation.js"
import {
  adminIdempotencyScope,
  hashRequest,
  iso,
  isoOrNull,
  requireIdempotencyKey,
  runAdminMutation,
} from "./adminRouteKit.js"

const MESSAGES_ROUTE = "/v1/admin/email-messages"
const SEND_PERMISSION = "email_messages.send"

export interface AdminEmailMessageRouteDeps extends AdminEmailMessageDeps {
  readonly webAuth: WebAuthDeps
  readonly unitOfWork: UnitOfWork
  readonly idempotencyRepository: IdempotencyRepository
  readonly config: AdminEmailMessageDeps["config"] & { readonly idempotencyTtlMs: number }
}

const previewQuerySchema = z
  .object({ templateId: z.string().uuid(), userId: z.string().uuid().optional() })
  .strict()

const revisionSchema = z.number().int().positive()

const sendBodySchema = z
  .object({
    templateId: z.string().uuid(),
    revision: revisionSchema,
    userId: z.string().uuid(),
    expectedEmailRevision: z.string().regex(/^[1-9][0-9]{0,18}$/u),
  })
  .strict()

const testBodySchema = z.object({ templateId: z.string().uuid(), revision: revisionSchema }).strict()

const queuedBody = (queued: QueuedAdminEmail) => ({
  messageId: queued.messageId,
  deliveryId: queued.deliveryId,
  recipient: queued.recipientMasked,
  test: queued.test,
  state: "queued" as const,
  queuedAt: iso(queued.queuedAt),
})

const preview = async (deps: AdminEmailMessageRouteDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, [SEND_PERMISSION])
  const query = parseOrThrow(previewQuerySchema, request.query)
  const result = await deps.unitOfWork.execute((tx) =>
    previewAdminEmail(tx, deps, { templateId: query.templateId, userId: query.userId ?? null }),
  )
  return reply.sendData(
    {
      templateId: result.template.id,
      templateName: result.template.name,
      revision: result.template.currentRevision,
      subject: result.email.subject,
      text: result.email.text,
      html: result.email.html,
      sample: result.sample,
      recipient:
        result.recipient === null
          ? null
          : {
              userId: result.recipient.userId,
              fullName: result.recipient.fullName,
              maskedEmail: result.recipient.maskedEmail,
              emailRevision: result.recipient.emailRevision,
              block: result.recipient.block,
              nextSendAllowedAt: isoOrNull(result.recipient.nextSendAllowedAt),
            },
    },
    { status: 200 },
  )
}

const send = async (
  deps: AdminEmailMessageRouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  route: string,
  input: Readonly<{ templateId: string; revision: number; target: SendTarget }>,
) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, [SEND_PERMISSION])
  const key = requireIdempotencyKey(request)
  const result = await runAdminMutation({
    unitOfWork: deps.unitOfWork,
    idempotencyRepository: deps.idempotencyRepository,
    now: deps.clock(),
    idempotencyTtlMs: deps.config.idempotencyTtlMs,
    scope: adminIdempotencyScope(principal.userId, route, key),
    requestHash: hashRequest({ templateId: input.templateId, revision: input.revision, ...input.target }),
    execute: async (tx) => ({
      status: 202,
      body: queuedBody(
        await sendAdminEmail(tx, deps, { ...input, actorUserId: principal.userId, requestId: request.requestId }),
      ),
    }),
  })
  return reply.sendData(result.body, { status: result.status, ...(result.replay ? { idempotencyReplay: true } : {}) })
}

const sendToClient = (deps: AdminEmailMessageRouteDeps, request: FastifyRequest, reply: FastifyReply) => {
  const body = parseOrThrow(sendBodySchema, request.body)
  return send(deps, request, reply, MESSAGES_ROUTE, {
    templateId: body.templateId,
    revision: body.revision,
    target: { kind: "client", userId: body.userId, expectedEmailRevision: body.expectedEmailRevision },
  })
}

const sendTest = (deps: AdminEmailMessageRouteDeps, request: FastifyRequest, reply: FastifyReply) => {
  const body = parseOrThrow(testBodySchema, request.body)
  return send(deps, request, reply, `${MESSAGES_ROUTE}/test`, {
    templateId: body.templateId,
    revision: body.revision,
    target: { kind: "test" },
  })
}

export const registerAdminEmailMessageRoutes = (application: FastifyInstance, deps: AdminEmailMessageRouteDeps): void => {
  application.get(`${MESSAGES_ROUTE}/preview`, (request, reply) => preview(deps, request, reply))
  application.post(MESSAGES_ROUTE, (request, reply) => sendToClient(deps, request, reply))
  application.post(`${MESSAGES_ROUTE}/test`, (request, reply) => sendTest(deps, request, reply))
}
