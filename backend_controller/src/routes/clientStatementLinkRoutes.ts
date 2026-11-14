import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { z } from "zod"

import type { CryptoContext } from "../crypto/context.js"
import type { UnitOfWork } from "../db/database.js"
import { resolveClientPrincipal, type ClientRequestAuthDeps } from "../domain/auth/clientWebAuth.js"
import { issueStatementLink, openStatementLink, type StatementLinkDeps } from "../domain/client/statementLinks.js"
import {
  renderFailurePage,
  renderStatementPage,
  renderUnavailablePage,
  STATEMENT_PAGE_CSP,
} from "../domain/client/statementPage.js"
import { parseOrThrow } from "../http/validation.js"
import type { ClientValueEntryRepository } from "../repositories/clientValueEntryRepository.js"
import { createStatementLinkRepository } from "../repositories/statementLinkRepository.js"

export interface ClientStatementLinkRouteDeps extends ClientRequestAuthDeps {
  readonly unitOfWork: UnitOfWork
  readonly clientValueEntryRepository: ClientValueEntryRepository
  readonly crypto: CryptoContext
  readonly clock: () => Date
  readonly config: Readonly<{ linkTtlMs: number }>
}

type RouteDeps = ClientStatementLinkRouteDeps & StatementLinkDeps

const ISSUE_ROUTE = "/v1/client/statement-links"
const OPEN_ROUTE = "/v1/public/statement-links/:token"

const statementMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u)

const issueBodySchema = z.object({ fromPeriod: statementMonth, toPeriod: statementMonth }).strict()

const openParamsSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/u) }).strict()

const issueLink = async (deps: RouteDeps, request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
  const principal = await resolveClientPrincipal(request, deps)
  const body = parseOrThrow(issueBodySchema, request.body ?? {})
  const issued = await deps.unitOfWork.execute((tx) =>
    issueStatementLink(tx, deps, { userId: principal.userId, fromPeriod: body.fromPeriod, toPeriod: body.toPeriod }),
  )
  return reply.sendData({ token: issued.token, expiresAt: issued.expiresAt.toISOString() }, { status: 201 })
}

const sendPage = (reply: FastifyReply, status: number, html: string): FastifyReply =>
  reply
    .status(status)
    .header("content-type", "text/html; charset=utf-8")
    .header("cache-control", "no-store")
    .header("referrer-policy", "no-referrer")
    .header("content-security-policy", STATEMENT_PAGE_CSP)
    .send(html)

const openLink = async (deps: RouteDeps, request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
  const params = openParamsSchema.safeParse(request.params)
  if (!params.success) return sendPage(reply, 404, renderUnavailablePage())
  try {
    const html = await deps.unitOfWork.execute(async (tx) => {
      const opened = await openStatementLink(tx, deps, params.data.token)
      return opened.kind === "statement" ? renderStatementPage(opened.document) : null
    })
    return html === null ? sendPage(reply, 404, renderUnavailablePage()) : sendPage(reply, 200, html)
  } catch {
    request.log.error({ errorCode: "STATEMENT_LINK_FAILED", requestId: request.requestId }, "Statement link could not be opened")
    return sendPage(reply, 500, renderFailurePage())
  }
}

export const registerClientStatementLinkRoutes = (application: FastifyInstance, base: ClientStatementLinkRouteDeps): void => {
  const deps: RouteDeps = { ...base, statementLinkRepository: createStatementLinkRepository() }
  application.post(ISSUE_ROUTE, (request, reply) => issueLink(deps, request, reply))
  application.get(OPEN_ROUTE, (request, reply) => openLink(deps, request, reply))
}
