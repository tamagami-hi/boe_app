import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"

import type { UnitOfWork } from "../db/database.js"
import type { IdempotencyRepository } from "../db/repositories.js"
import { requireAnyPermission, resolveAdminPrincipal } from "../domain/admin/adminAccess.js"
import {
  correctClientContacts,
  readContactHistory,
  releaseClosedAccountContacts,
  type ClientContactsDeps,
} from "../domain/admin/clientContacts.js"
import type { WebAuthDeps } from "../domain/auth/webAuth.js"
import { normalizePhone } from "../domain/shared/phoneNumber.js"
import { parseOrThrow } from "../http/validation.js"
import type { ContactHistoryEntry } from "../repositories/userContactRepository.js"
import {
  adminIdempotencyScope,
  hashRequest,
  iso,
  isoOrNull,
  reasonCodeSchema,
  reasonDetailSchema,
  requireIdempotencyKey,
  runAdminMutation,
  uuidParam,
} from "./adminRouteKit.js"

const CORRECTION_ROUTE = "/v1/admin/clients/:userId/contact-correction"
const RELEASE_ROUTE = "/v1/admin/users/:userId/contact-release"
const HISTORY_ROUTE = "/v1/admin/users/:userId/contact-history"

export interface AdminClientContactDeps extends ClientContactsDeps {
  readonly webAuth: WebAuthDeps
  readonly unitOfWork: UnitOfWork
  readonly idempotencyRepository: IdempotencyRepository
  readonly config: ClientContactsDeps["config"] & { readonly idempotencyTtlMs: number }
}

const expectedVersionSchema = z.number().int().positive()

const correctionBodySchema = z
  .object({
    email: z.string().trim().email().max(254).optional(),
    phone: z.string().trim().min(8).max(32).optional(),
    expectedVersion: expectedVersionSchema,
  })
  .strict()
  .refine((body) => body.email !== undefined || body.phone !== undefined, {
    message: "must include an email or a phone",
    path: ["email"],
  })

const releaseBodySchema = z
  .object({
    expectedVersion: expectedVersionSchema,
    reasonCode: reasonCodeSchema.optional(),
    reason: reasonDetailSchema.optional(),
  })
  .strict()

const userIdOf = (request: FastifyRequest): string =>
  parseOrThrow(uuidParam, (request.params as { userId?: unknown }).userId)

const historyEntryBody = (entry: ContactHistoryEntry) => ({
  id: entry.id,
  kind: entry.changeKind,
  previousEmail: entry.previousEmail,
  previousPhone: entry.previousPhone,
  newEmail: entry.newEmail,
  newPhone: entry.newPhone,
  actorUserId: entry.actorUserId,
  actorName: entry.actorName,
  reasonCode: entry.reasonCode,
  reason: entry.reasonDetail,
  createdAt: iso(entry.createdAt),
})

const correctContacts = async (deps: AdminClientContactDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, ["clients.create"])
  requireAnyPermission(principal, ["clients.password_links.send"])
  const userId = userIdOf(request)
  const body = parseOrThrow(correctionBodySchema, request.body)
  const key = requireIdempotencyKey(request)
  const emailNormalized = body.email?.toLowerCase()
  const phoneE164 = body.phone === undefined ? undefined : normalizePhone(body.phone)

  const result = await runAdminMutation({
    unitOfWork: deps.unitOfWork,
    idempotencyRepository: deps.idempotencyRepository,
    now: deps.clock(),
    idempotencyTtlMs: deps.config.idempotencyTtlMs,
    retention: "durable",
    scope: adminIdempotencyScope(principal.userId, CORRECTION_ROUTE, key),
    requestHash: hashRequest({
      userId,
      emailNormalized: emailNormalized ?? null,
      phoneE164: phoneE164 ?? null,
      expectedVersion: body.expectedVersion,
    }),
    execute: async (tx) => {
      const corrected = await correctClientContacts(tx, deps, {
        userId,
        ...(emailNormalized === undefined ? {} : { emailNormalized }),
        ...(phoneE164 === undefined ? {} : { phoneE164 }),
        expectedVersion: body.expectedVersion,
        actorUserId: principal.userId,
        requestId: request.requestId,
      })
      const link = corrected.passwordLink
      return {
        status: 200,
        body: {
          userId,
          email: corrected.user.email_normalized,
          phone: corrected.user.phone_e164,
          version: Number(corrected.user.version),
          emailChanged: corrected.emailChanged,
          phoneChanged: corrected.phoneChanged,
          passwordLink:
            link === null
              ? null
              : {
                  purpose: link.purpose,
                  expiresAt: link.expiresAt.toISOString(),
                  deliveryId: link.deliveryId,
                  deliveryState: "queued" as const,
                },
        },
      }
    },
  })

  return reply.sendData(result.body, {
    status: result.status,
    ...(result.replay ? { idempotencyReplay: true } : {}),
  })
}

const releaseContacts = async (deps: AdminClientContactDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, ["users.close"])
  const userId = userIdOf(request)
  const body = parseOrThrow(releaseBodySchema, request.body)
  const key = requireIdempotencyKey(request)

  const result = await runAdminMutation({
    unitOfWork: deps.unitOfWork,
    idempotencyRepository: deps.idempotencyRepository,
    now: deps.clock(),
    idempotencyTtlMs: deps.config.idempotencyTtlMs,
    retention: "durable",
    scope: adminIdempotencyScope(principal.userId, RELEASE_ROUTE, key),
    requestHash: hashRequest({
      userId,
      expectedVersion: body.expectedVersion,
      reasonCode: body.reasonCode ?? null,
      reason: body.reason ?? null,
    }),
    execute: async (tx) => {
      const released = await releaseClosedAccountContacts(tx, deps, {
        userId,
        expectedVersion: body.expectedVersion,
        reasonCode: body.reasonCode ?? null,
        reasonDetail: body.reason ?? null,
        actorUserId: principal.userId,
        requestId: request.requestId,
      })
      return {
        status: 200,
        body: { userId, version: Number(released.user.version), releasedAt: iso(released.releasedAt) },
      }
    },
  })

  return reply.sendData(result.body, {
    status: result.status,
    ...(result.replay ? { idempotencyReplay: true } : {}),
  })
}

const getContactHistory = async (deps: AdminClientContactDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, ["users.read"])
  const userId = userIdOf(request)
  const history = await deps.unitOfWork.execute((tx) => readContactHistory(tx, deps, userId))
  return reply.sendData(
    {
      userId,
      contactsReleasedAt: isoOrNull(history.releasedAt),
      entries: history.entries.map(historyEntryBody),
    },
    { status: 200 },
  )
}

export const registerAdminClientContactRoutes = (application: FastifyInstance, deps: AdminClientContactDeps): void => {
  application.post(CORRECTION_ROUTE, (request, reply) => correctContacts(deps, request, reply))
  application.post(RELEASE_ROUTE, (request, reply) => releaseContacts(deps, request, reply))
  application.get(HISTORY_ROUTE, (request, reply) => getContactHistory(deps, request, reply))
}
