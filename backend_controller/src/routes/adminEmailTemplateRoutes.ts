import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"

import type { UnitOfWork } from "../db/database.js"
import type { IdempotencyRepository } from "../db/repositories.js"
import { requireAnyPermission, resolveAdminPrincipal } from "../domain/admin/adminAccess.js"
import {
  createEmailTemplate,
  reviseEmailTemplate,
  setEmailTemplateArchived,
  type EmailTemplateDeps,
} from "../domain/admin/emailTemplates.js"
import { TEMPLATE_PLACEHOLDERS } from "../domain/admin/emailTemplateContent.js"
import type { WebAuthDeps } from "../domain/auth/webAuth.js"
import { AppError } from "../http/errorCatalog.js"
import { parseOrThrow } from "../http/validation.js"
import type { EmailTemplate, EmailTemplateRevision } from "../repositories/emailTemplateRepository.js"
import {
  adminIdempotencyScope,
  hashRequest,
  iso,
  isoOrNull,
  requireIdempotencyKey,
  runAdminMutation,
  uuidParam,
} from "./adminRouteKit.js"

const TEMPLATES_ROUTE = "/v1/admin/email-templates"
const WRITE_PERMISSION = "email_templates.write"
const READ_PERMISSIONS = ["email_templates.write", "email_messages.send"] as const
const REVISION_HISTORY = 20

export interface AdminEmailTemplateDeps extends EmailTemplateDeps {
  readonly webAuth: WebAuthDeps
  readonly unitOfWork: UnitOfWork
  readonly idempotencyRepository: IdempotencyRepository
  readonly config: { readonly idempotencyTtlMs: number }
}

const listQuerySchema = z.object({ includeArchived: z.enum(["true", "false"]).optional() }).strict()

const contentSchema = {
  name: z.string().max(200),
  description: z.string().max(1_000).default(""),
  subject: z.string().max(500),
  body: z.string().max(10_000),
}

const createBodySchema = z.object(contentSchema).strict()
const reviseBodySchema = z.object({ ...contentSchema, expectedVersion: z.number().int().positive() }).strict()
const archiveBodySchema = z.object({ expectedVersion: z.number().int().positive() }).strict()

const revisionBody = (revision: EmailTemplateRevision) => ({
  revision: revision.revision,
  subject: revision.subject,
  body: revision.body,
  createdAt: iso(revision.createdAt),
})

const templateBody = (template: EmailTemplate) => ({
  templateId: template.id,
  slug: template.slug,
  name: template.name,
  description: template.description,
  preloaded: template.preloaded,
  archivedAt: isoOrNull(template.archivedAt),
  updatedAt: iso(template.updatedAt),
  version: Number(template.version),
  currentRevision: template.currentRevision,
  subject: template.current.subject,
  body: template.current.body,
})

const templateIdOf = (request: FastifyRequest): string =>
  parseOrThrow(uuidParam, (request.params as { templateId?: unknown }).templateId)

const listTemplates = async (deps: AdminEmailTemplateDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, [...READ_PERMISSIONS])
  const query = parseOrThrow(listQuerySchema, request.query)
  const templates = await deps.unitOfWork.execute((tx) =>
    deps.emailTemplateRepository.list(tx, { includeArchived: query.includeArchived === "true" }),
  )
  return reply.sendData({ items: templates.map(templateBody), placeholders: [...TEMPLATE_PLACEHOLDERS] }, { status: 200 })
}

const getTemplate = async (deps: AdminEmailTemplateDeps, request: FastifyRequest, reply: FastifyReply) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: false })
  requireAnyPermission(principal, [...READ_PERMISSIONS])
  const templateId = templateIdOf(request)
  const found = await deps.unitOfWork.execute(async (tx) => {
    const template = await deps.emailTemplateRepository.findById(tx, templateId)
    if (template === null) return null
    return { template, revisions: await deps.emailTemplateRepository.listRevisions(tx, templateId, REVISION_HISTORY) }
  })
  if (found === null) throw new AppError("RESOURCE_NOT_FOUND")
  return reply.sendData(
    { ...templateBody(found.template), revisions: found.revisions.map(revisionBody), placeholders: [...TEMPLATE_PLACEHOLDERS] },
    { status: 200 },
  )
}

const mutateTemplate = async (
  deps: AdminEmailTemplateDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  route: string,
  canonical: Readonly<Record<string, unknown>>,
  status: number,
  run: (tx: Parameters<Parameters<UnitOfWork["execute"]>[0]>[0], actorUserId: string) => Promise<EmailTemplate>,
) => {
  const principal = await resolveAdminPrincipal(request, deps.webAuth, { requireCsrf: true })
  requireAnyPermission(principal, [WRITE_PERMISSION])
  const key = requireIdempotencyKey(request)
  const result = await runAdminMutation({
    unitOfWork: deps.unitOfWork,
    idempotencyRepository: deps.idempotencyRepository,
    now: deps.clock(),
    idempotencyTtlMs: deps.config.idempotencyTtlMs,
    scope: adminIdempotencyScope(principal.userId, route, key),
    requestHash: hashRequest(canonical),
    execute: async (tx) => ({ status, body: templateBody(await run(tx, principal.userId)) }),
  })
  return reply.sendData(result.body, { status: result.status, ...(result.replay ? { idempotencyReplay: true } : {}) })
}

const createTemplate = async (deps: AdminEmailTemplateDeps, request: FastifyRequest, reply: FastifyReply) => {
  const body = parseOrThrow(createBodySchema, request.body)
  return mutateTemplate(deps, request, reply, TEMPLATES_ROUTE, body, 201, (tx, actorUserId) =>
    createEmailTemplate(tx, deps, { ...body, actorUserId, requestId: request.requestId }),
  )
}

const reviseTemplate = async (deps: AdminEmailTemplateDeps, request: FastifyRequest, reply: FastifyReply) => {
  const templateId = templateIdOf(request)
  const body = parseOrThrow(reviseBodySchema, request.body)
  return mutateTemplate(deps, request, reply, `${TEMPLATES_ROUTE}/:templateId/revisions`, { templateId, ...body }, 200, (tx, actorUserId) =>
    reviseEmailTemplate(tx, deps, {
      ...body,
      templateId,
      expectedVersion: String(body.expectedVersion),
      actorUserId,
      requestId: request.requestId,
    }),
  )
}

const archiveTemplate = (archived: boolean) =>
  async (deps: AdminEmailTemplateDeps, request: FastifyRequest, reply: FastifyReply) => {
    const templateId = templateIdOf(request)
    const body = parseOrThrow(archiveBodySchema, request.body)
    const segment = archived ? "archive" : "restore"
    return mutateTemplate(deps, request, reply, `${TEMPLATES_ROUTE}/:templateId/${segment}`, { templateId, ...body }, 200, (tx, actorUserId) =>
      setEmailTemplateArchived(tx, deps, {
        templateId,
        expectedVersion: String(body.expectedVersion),
        archived,
        actorUserId,
        requestId: request.requestId,
      }),
    )
  }

export const registerAdminEmailTemplateRoutes = (application: FastifyInstance, deps: AdminEmailTemplateDeps): void => {
  application.get(TEMPLATES_ROUTE, (request, reply) => listTemplates(deps, request, reply))
  application.get(`${TEMPLATES_ROUTE}/:templateId`, (request, reply) => getTemplate(deps, request, reply))
  application.post(TEMPLATES_ROUTE, (request, reply) => createTemplate(deps, request, reply))
  application.post(`${TEMPLATES_ROUTE}/:templateId/revisions`, (request, reply) => reviseTemplate(deps, request, reply))
  application.post(`${TEMPLATES_ROUTE}/:templateId/archive`, (request, reply) => archiveTemplate(true)(deps, request, reply))
  application.post(`${TEMPLATES_ROUTE}/:templateId/restore`, (request, reply) => archiveTemplate(false)(deps, request, reply))
}
