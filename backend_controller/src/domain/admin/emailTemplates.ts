import type { Transaction } from "../../db/repositories.js"
import { AppError } from "../../http/errorCatalog.js"
import type { AuditWriteRepository } from "../../repositories/auditRepository.js"
import type { EmailTemplate, EmailTemplateRepository } from "../../repositories/emailTemplateRepository.js"
import { slugFromName, templateContentProblems } from "./emailTemplateContent.js"

const NAME_MAX = 120
const DESCRIPTION_MAX = 500

export interface EmailTemplateDeps {
  readonly emailTemplateRepository: EmailTemplateRepository
  readonly auditRepository: AuditWriteRepository
  readonly clock: () => Date
}

export interface TemplateContentInput {
  readonly name: string
  readonly description: string
  readonly subject: string
  readonly body: string
}

const assertContent = (input: TemplateContentInput): TemplateContentInput => {
  const name = input.name.trim()
  const description = input.description.trim()
  const fields: Record<string, readonly string[]> = { ...templateContentProblems(input.subject, input.body) }
  if (name === "" || name.length > NAME_MAX) fields.name = [`must be 1 to ${String(NAME_MAX)} characters`]
  if (description.length > DESCRIPTION_MAX) fields.description = [`must be at most ${String(DESCRIPTION_MAX)} characters`]
  if (Object.keys(fields).length > 0) throw new AppError("VALIDATION_FAILED", { fields })
  return { name, description, subject: input.subject.trim(), body: input.body.trim() }
}

const audit = (
  tx: Transaction,
  deps: EmailTemplateDeps,
  input: Readonly<{ command: string; template: EmailTemplate; actorUserId: string; requestId: string }>,
) =>
  deps.auditRepository.append(tx, {
    actorType: "admin",
    actorUserId: input.actorUserId,
    command: input.command,
    entityType: "email_template",
    entityId: input.template.id,
    requestId: input.requestId,
    entityVersion: Number(input.template.version),
    metadata: { slug: input.template.slug, revision: input.template.currentRevision },
  })

export const createEmailTemplate = async (
  tx: Transaction,
  deps: EmailTemplateDeps,
  input: TemplateContentInput & Readonly<{ actorUserId: string; requestId: string }>,
): Promise<EmailTemplate> => {
  const content = assertContent(input)
  const slug = slugFromName(content.name)
  if ((await deps.emailTemplateRepository.findBySlug(tx, slug)) !== null) {
    throw new AppError("STATE_CONFLICT", { message: "A template with this name already exists. Choose another name." })
  }
  const template = await deps.emailTemplateRepository.create(tx, {
    ...content,
    slug,
    actorUserId: input.actorUserId,
    now: deps.clock(),
  })
  await audit(tx, deps, { command: "email_template.created", template, actorUserId: input.actorUserId, requestId: input.requestId })
  return template
}

export const reviseEmailTemplate = async (
  tx: Transaction,
  deps: EmailTemplateDeps,
  input: TemplateContentInput & Readonly<{ templateId: string; expectedVersion: string; actorUserId: string; requestId: string }>,
): Promise<EmailTemplate> => {
  const content = assertContent(input)
  const existing = await deps.emailTemplateRepository.findById(tx, input.templateId)
  if (existing === null) throw new AppError("RESOURCE_NOT_FOUND")
  if (existing.archivedAt !== null) {
    throw new AppError("STATE_CONFLICT", { message: "This template is archived. Restore it before editing." })
  }
  const template = await deps.emailTemplateRepository.revise(tx, {
    ...content,
    templateId: input.templateId,
    expectedVersion: input.expectedVersion,
    actorUserId: input.actorUserId,
    now: deps.clock(),
  })
  if (template === null) {
    throw new AppError("STATE_CONFLICT", { message: "Someone changed this template since you opened it. Reload it and edit again." })
  }
  await audit(tx, deps, { command: "email_template.revised", template, actorUserId: input.actorUserId, requestId: input.requestId })
  return template
}

export const setEmailTemplateArchived = async (
  tx: Transaction,
  deps: EmailTemplateDeps,
  input: Readonly<{ templateId: string; expectedVersion: string; archived: boolean; actorUserId: string; requestId: string }>,
): Promise<EmailTemplate> => {
  const existing = await deps.emailTemplateRepository.findById(tx, input.templateId)
  if (existing === null) throw new AppError("RESOURCE_NOT_FOUND")
  const template = await deps.emailTemplateRepository.setArchived(tx, {
    templateId: input.templateId,
    expectedVersion: input.expectedVersion,
    archived: input.archived,
    now: deps.clock(),
  })
  if (template === null) {
    throw new AppError("STATE_CONFLICT", { message: "Someone changed this template since you opened it. Reload it and try again." })
  }
  await audit(tx, deps, {
    command: input.archived ? "email_template.archived" : "email_template.restored",
    template,
    actorUserId: input.actorUserId,
    requestId: input.requestId,
  })
  return template
}
