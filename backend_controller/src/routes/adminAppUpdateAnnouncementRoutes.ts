import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"

import { CACHE_KEYS, type Cache } from "../cache/cache.js"
import type { UnitOfWork } from "../db/database.js"
import type { IdempotencyRepository } from "../db/repositories.js"
import { requireAnyPermission, resolveAdminPrincipal } from "../domain/admin/adminAccess.js"
import {
  previewAppUpdateAnnouncement,
  sendAppUpdateAnnouncement,
  sendAppUpdateAnnouncementTest,
  type AnnouncementContent,
  type AppUpdateAnnouncementDeps,
} from "../domain/admin/appUpdateAnnouncement.js"
import type { WebAuthDeps } from "../domain/auth/webAuth.js"
import { createFixedWindowRateLimiter } from "../http/rateLimit.js"
import { parseOrThrow } from "../http/validation.js"
import { adminIdempotencyScope, hashRequest, requireIdempotencyKey, runAdminMutation } from "./adminRouteKit.js"

const ANNOUNCEMENTS_ROUTE = "/v1/admin/app-update-announcements"
const SEND_PERMISSION = "email_messages.send"
const ENFORCE_PERMISSION = "config.publish"
const TEST_WINDOW_MS = 15 * 60_000
const TEST_MAX_PER_WINDOW = 5
const MESSAGE_MAX = 500

export interface AdminAppUpdateAnnouncementRouteDeps extends AppUpdateAnnouncementDeps {
  readonly webAuth: WebAuthDeps
  readonly unitOfWork: UnitOfWork
  readonly idempotencyRepository: IdempotencyRepository
  readonly cache: Cache
  readonly config: AppUpdateAnnouncementDeps["config"] & { readonly idempotencyTtlMs: number }
}

const messageSchema = z.string().trim().max(MESSAGE_MAX).optional()

const previewQuerySchema = z
  .object({ mandatory: z.enum(["true", "false"]).default("false"), message: messageSchema })
  .strict()

const sendBodySchema = z
  .object({ versionCode: z.number().int().positive(), mandatory: z.boolean(), message: messageSchema })
  .strict()

const contentOf = (mandatory: boolean, message: string | undefined): AnnouncementContent => ({
  mandatory,
  message: message === undefined || message === "" ? null : message,
})

const preview = async (deps: AdminAppUpdateAnnouncementRouteDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, [SEND_PERMISSION])
  const query = parseOrThrow(previewQuerySchema, request.query)
  const result = await deps.unitOfWork.execute((tx) =>
    previewAppUpdateAnnouncement(tx, deps, contentOf(query.mandatory === "true", query.message)),
  )
  return reply.sendData(
    {
      release: result.release,
      subject: result.email?.subject ?? null,
      text: result.email?.text ?? null,
      html: result.email?.html ?? null,
      recipientCount: result.recipientCount,
      alreadySent: result.alreadySent,
      currentMinimum: result.currentMinimum,
    },
    { status: 200 },
  )
}

const authorizeSend = async (deps: AdminAppUpdateAnnouncementRouteDeps, request: FastifyRequest, mandatory: boolean) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, [SEND_PERMISSION])
  if (mandatory) requireAnyPermission(principal, [ENFORCE_PERMISSION])
  return principal
}

const send = async (deps: AdminAppUpdateAnnouncementRouteDeps, request: FastifyRequest, reply: FastifyReply) => {
  const body = parseOrThrow(sendBodySchema, request.body)
  const principal = await authorizeSend(deps, request, body.mandatory)
  const key = requireIdempotencyKey(request)
  const content = contentOf(body.mandatory, body.message)
  const result = await runAdminMutation({
    unitOfWork: deps.unitOfWork,
    idempotencyRepository: deps.idempotencyRepository,
    now: deps.clock(),
    idempotencyTtlMs: deps.config.idempotencyTtlMs,
    scope: adminIdempotencyScope(principal.userId, ANNOUNCEMENTS_ROUTE, key),
    requestHash: hashRequest({ versionCode: body.versionCode, ...content }),
    execute: async (tx) => {
      const sent = await sendAppUpdateAnnouncement(tx, deps, {
        ...content,
        versionCode: body.versionCode,
        actorUserId: principal.userId,
        requestId: request.requestId,
      })
      return {
        status: 202,
        body: {
          announcementId: sent.announcementId,
          version: sent.release.version,
          versionCode: sent.release.versionCode,
          mandatory: sent.mandatory,
          recipientCount: sent.recipientCount,
          appConfigVersion: sent.appConfigVersion,
        },
      }
    },
  })
  if (body.mandatory) await deps.cache.invalidate([CACHE_KEYS.appConfig])
  return reply.sendData(result.body, { status: result.status, ...(result.replay ? { idempotencyReplay: true } : {}) })
}

const sendTest =
  (testLimiter: ReturnType<typeof createFixedWindowRateLimiter>) =>
  async (deps: AdminAppUpdateAnnouncementRouteDeps, request: FastifyRequest, reply: FastifyReply) => {
    const body = parseOrThrow(sendBodySchema, request.body)
    const principal = await authorizeSend(deps, request, false)
    const key = requireIdempotencyKey(request)
    const content = contentOf(body.mandatory, body.message)
    const result = await runAdminMutation({
      unitOfWork: deps.unitOfWork,
      idempotencyRepository: deps.idempotencyRepository,
      now: deps.clock(),
      idempotencyTtlMs: deps.config.idempotencyTtlMs,
      scope: adminIdempotencyScope(principal.userId, `${ANNOUNCEMENTS_ROUTE}/test`, key),
      requestHash: hashRequest({ versionCode: body.versionCode, ...content }),
      execute: async (tx) => {
        testLimiter.hit(principal.userId)
        const sent = await sendAppUpdateAnnouncementTest(tx, deps, {
          ...content,
          versionCode: body.versionCode,
          actorUserId: principal.userId,
          requestId: request.requestId,
        })
        return { status: 202, body: { deliveryId: sent.deliveryId, recipient: sent.recipientMasked, state: "queued" as const } }
      },
    })
    return reply.sendData(result.body, { status: result.status, ...(result.replay ? { idempotencyReplay: true } : {}) })
  }

export const registerAdminAppUpdateAnnouncementRoutes = (
  application: FastifyInstance,
  deps: AdminAppUpdateAnnouncementRouteDeps,
): void => {
  const testLimiter = createFixedWindowRateLimiter({ windowMs: TEST_WINDOW_MS, maxRequests: TEST_MAX_PER_WINDOW }, deps.clock)
  const test = sendTest(testLimiter)
  application.get(`${ANNOUNCEMENTS_ROUTE}/preview`, (request, reply) => preview(deps, request, reply))
  application.post(ANNOUNCEMENTS_ROUTE, (request, reply) => send(deps, request, reply))
  application.post(`${ANNOUNCEMENTS_ROUTE}/test`, (request, reply) => test(deps, request, reply))
}
