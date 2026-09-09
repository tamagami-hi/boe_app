import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"

import type { UnitOfWork } from "../db/database.js"
import type { IdempotencyRepository } from "../db/repositories.js"
import { requireAnyPermission, resolveAdminPrincipal } from "../domain/admin/adminAccess.js"
import {
  createClientAccount,
  type CreateClientAccountDeps,
} from "../domain/admin/createClientAccount.js"
import type { WebAuthDeps } from "../domain/auth/webAuth.js"
import { AppError } from "../http/errorCatalog.js"
import { parseOrThrow } from "../http/validation.js"
import { sendPasswordInvite, type PasswordRoutesDeps } from "./passwordRoutes.js"
import {
  adminIdempotencyScope,
  hashRequest,
  requireIdempotencyKey,
  runAdminMutation,
} from "./adminRouteKit.js"

const CLIENTS_ROUTE = "/v1/admin/clients"

export interface AdminClientOnboardingDeps extends CreateClientAccountDeps {
  readonly webAuth: WebAuthDeps
  readonly unitOfWork: UnitOfWork
  readonly idempotencyRepository: IdempotencyRepository
  readonly emailSender: PasswordRoutesDeps["emailSender"]
  readonly config: CreateClientAccountDeps["config"] & { readonly idempotencyTtlMs: number } & {
    readonly resetUrlBase: string | null
  }
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

  const pendingInvites: Readonly<{ email: string; rawToken: string }>[] = []

  const result = await runAdminMutation({
    unitOfWork: deps.unitOfWork,
    idempotencyRepository: deps.idempotencyRepository,
    now: deps.clock(),
    idempotencyTtlMs: deps.config.idempotencyTtlMs,
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
      pendingInvites.push({ email: created.invite.email, rawToken: created.invite.rawToken })
      return {
        status: 201,
        body: {
          userId: created.userId,
          accountState: "active" as const,
          emailVerification: "pending" as const,
        },
      }
    },
  })

  const invite = pendingInvites[0]
  if (invite !== undefined) {
    try {
      await sendPasswordInvite(deps, invite)
    } catch {
      request.log.error(
        { requestId: request.requestId, userId: result.body.userId },
        "client account created but the invite mail could not be sent",
      )
    }
  }

  return reply.sendData(result.body, {
    status: result.status,
    ...(result.replay ? { idempotencyReplay: true } : {}),
  })
}

export const registerAdminClientOnboardingRoutes = (
  application: FastifyInstance,
  deps: AdminClientOnboardingDeps,
): void => {
  application.post(CLIENTS_ROUTE, (request, reply) => createClient(deps, request, reply))
}
