import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"

import type { UnitOfWork } from "../db/database.js"
import type { IdempotencyRepository } from "../db/repositories.js"
import { requireAnyPermission, resolveAdminPrincipal } from "../domain/admin/adminAccess.js"
import { readClientPasswordAccess, sendClientPasswordLink } from "../domain/admin/clientPasswordLink.js"
import {
  createClientAccount,
  type CreateClientAccountDeps,
} from "../domain/admin/createClientAccount.js"
import type { QueuedPasswordLink } from "../domain/auth/passwordLinkMail.js"
import { requirePasswordLinkBase } from "../domain/auth/passwordLinkUrl.js"
import type { WebAuthDeps } from "../domain/auth/webAuth.js"
import { AppError } from "../http/errorCatalog.js"
import { parseOrThrow } from "../http/validation.js"
import {
  adminIdempotencyScope,
  hashRequest,
  iso,
  isoOrNull,
  requireIdempotencyKey,
  runAdminMutation,
  uuidParam,
} from "./adminRouteKit.js"

const CLIENTS_ROUTE = "/v1/admin/clients"
const PASSWORD_LINK_ROUTE = "/v1/admin/clients/:userId/password-link"
const SEND_PERMISSION = "clients.password_links.send"

export interface AdminClientOnboardingDeps extends CreateClientAccountDeps {
  readonly webAuth: WebAuthDeps
  readonly unitOfWork: UnitOfWork
  readonly idempotencyRepository: IdempotencyRepository
  readonly config: CreateClientAccountDeps["config"] & { readonly idempotencyTtlMs: number }
}

const bodySchema = z
  .object({
    fullName: z
      .string()
      .trim()
      .refine((value) => Array.from(value).length >= 2 && Array.from(value).length <= 120, {
        message: "must be 2 to 120 characters",
      })
      .refine((value) => !/[\u0000-\u001f\u007f-\u009f]/u.test(value), {
        message: "must not contain control characters",
      }),
    email: z.string().trim().email().max(254),
    phone: z.string().trim().min(8).max(32),
  })
  .strict()

const normalizePhone = (raw: string): string => {
  const candidate = raw.replace(/[\s()-]/gu, "")
  if (!/^\+[1-9][0-9]{7,14}$/u.test(candidate)) {
    throw new AppError("VALIDATION_FAILED", {
      fields: { phone: ["must be a valid E.164 phone number"] },
    })
  }
  return candidate
}

const emptyBodySchema = z.object({}).strict().optional()

const queuedLinkBody = (link: QueuedPasswordLink) => ({
  purpose: link.purpose,
  expiresAt: link.expiresAt.toISOString(),
  deliveryId: link.deliveryId,
  deliveryState: "queued" as const,
})

const userIdOf = (request: FastifyRequest): string =>
  parseOrThrow(uuidParam, (request.params as { userId?: unknown }).userId)

const createClient = async (
  deps: AdminClientOnboardingDeps,
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, ["clients.create"])
  const body = parseOrThrow(bodySchema, request.body)
  const key = requireIdempotencyKey(request)

  const emailNormalized = body.email.toLowerCase()
  const phoneE164 = normalizePhone(body.phone)

  const result = await runAdminMutation({
    unitOfWork: deps.unitOfWork,
    idempotencyRepository: deps.idempotencyRepository,
    now: deps.clock(),
    idempotencyTtlMs: deps.config.idempotencyTtlMs,
    retention: "durable",
    scope: adminIdempotencyScope(principal.userId, CLIENTS_ROUTE, key),
    requestHash: hashRequest({ emailNormalized, phoneE164, fullName: body.fullName }),
    execute: async (tx) => {
      const created = await createClientAccount(tx, deps, {
        emailNormalized,
        phoneE164,
        fullName: body.fullName,
        actorUserId: principal.userId,
        requestId: request.requestId,
      })
      return {
        status: 201,
        body: {
          userId: created.userId,
          accountState: "active" as const,
          emailVerification: "pending" as const,
          passwordLink: queuedLinkBody(created.passwordLink),
        },
      }
    },
  })

  return reply.sendData(result.body, {
    status: result.status,
    ...(result.replay ? { idempotencyReplay: true } : {}),
  })
}

const sendPasswordLink = async (
  deps: AdminClientOnboardingDeps,
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, [SEND_PERMISSION])
  const userId = userIdOf(request)
  parseOrThrow(emptyBodySchema, request.body ?? undefined)
  const key = requireIdempotencyKey(request)
  const linkBase = requirePasswordLinkBase(deps.config.passwordLinks)

  const result = await runAdminMutation({
    unitOfWork: deps.unitOfWork,
    idempotencyRepository: deps.idempotencyRepository,
    now: deps.clock(),
    idempotencyTtlMs: deps.config.idempotencyTtlMs,
    scope: adminIdempotencyScope(principal.userId, PASSWORD_LINK_ROUTE, key),
    requestHash: hashRequest({ userId }),
    execute: async (tx) => {
      const queued = await sendClientPasswordLink(tx, deps, {
        userId,
        actorUserId: principal.userId,
        requestId: request.requestId,
        linkBase,
      })
      return { status: 201, body: { userId, ...queuedLinkBody(queued) } }
    },
  })

  return reply.sendData(result.body, {
    status: result.status,
    ...(result.replay ? { idempotencyReplay: true } : {}),
  })
}

const getPasswordAccess = async (
  deps: AdminClientOnboardingDeps,
  request: FastifyRequest,
  reply: FastifyReply,
) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, ["users.read", SEND_PERMISSION])
  const userId = userIdOf(request)
  const now = deps.clock()
  const access = await deps.unitOfWork.execute((tx) => readClientPasswordAccess(tx, deps, { userId, now }))
  const link = access.latestLink

  return reply.sendData(
    {
      userId: access.userId,
      hasPassword: access.hasPassword,
      nextLinkAllowedAt: isoOrNull(access.nextLinkAllowedAt),
      latestLink:
        link === null
          ? null
          : {
              purpose: link.purpose,
              state: link.state,
              createdAt: iso(link.createdAt),
              expiresAt: iso(link.expiresAt),
              delivery:
                link.delivery === null
                  ? null
                  : {
                      deliveryId: link.delivery.deliveryId,
                      state: link.delivery.state,
                      lastErrorCode: link.delivery.lastErrorCode,
                      sentAt: isoOrNull(link.delivery.sentAt),
                      updatedAt: iso(link.delivery.updatedAt),
                    },
            },
    },
    { status: 200 },
  )
}

export const registerAdminClientOnboardingRoutes = (
  application: FastifyInstance,
  deps: AdminClientOnboardingDeps,
): void => {
  application.post(CLIENTS_ROUTE, (request, reply) => createClient(deps, request, reply))
  application.post(PASSWORD_LINK_ROUTE, (request, reply) => sendPasswordLink(deps, request, reply))
  application.get(PASSWORD_LINK_ROUTE, (request, reply) => getPasswordAccess(deps, request, reply))
}
