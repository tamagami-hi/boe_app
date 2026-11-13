import type { FastifyInstance, FastifyRequest } from "fastify"

import {
  confirmMaturityOffer,
  sendMaturityOptions,
  withdrawMaturityOffer,
  type ConfirmMaturityOfferCommand,
  type MaturityOfferDeps,
  type OwnOfferCommand,
} from "../domain/admin/maturityOffers.js"
import { parseOrThrow } from "../http/validation.js"
import {
  followUpOf,
  mutate,
  paramOf,
  resolutionBody,
  scheduleBody,
  SCHEDULE_ROUTE,
  type AdminMaturityScheduleDeps,
  type MutationPlan,
} from "./adminMaturityScheduleRoutes.js"
import {
  confirmOfferBodySchema,
  sendOptionsBodySchema,
  withdrawOfferBodySchema,
  type ConfirmOfferBody,
} from "./maturityScheduleProjection.js"

const SEND_ROUTE = `${SCHEDULE_ROUTE}/offers`
const OFFER_ROUTE = `${SEND_ROUTE}/:offerId`
const WITHDRAW_ROUTE = `${OFFER_ROUTE}/withdraw`
const CONFIRM_ROUTE = `${OFFER_ROUTE}/confirm`

export type AdminMaturityOfferDeps = AdminMaturityScheduleDeps &
  MaturityOfferDeps &
  Readonly<{ config: AdminMaturityScheduleDeps["config"] & MaturityOfferDeps["config"] }>

const sendPlan = (deps: AdminMaturityOfferDeps) => (request: FastifyRequest): MutationPlan => {
  const userId = paramOf(request, "userId")
  const scheduleId = paramOf(request, "scheduleId")
  const body = parseOrThrow(sendOptionsBodySchema, request.body)
  return {
    route: SEND_ROUTE,
    hash: { userId, scheduleId, ...body },
    execute: async (tx, actor) => {
      const sent = await sendMaturityOptions(tx, deps, {
        ...actor,
        userId,
        scheduleId,
        expectedVersion: body.expectedVersion,
        sip: followUpOf(body.sip),
        extension: body.extension,
      })
      return { status: 201, body: scheduleBody(deps, sent.schedule) }
    },
  }
}

const ownOffer = (request: FastifyRequest, versions: Readonly<{ expectedVersion: number; offerVersion: number }>) => ({
  userId: paramOf(request, "userId"),
  scheduleId: paramOf(request, "scheduleId"),
  offerId: paramOf(request, "offerId"),
  expectedVersion: versions.expectedVersion,
  offerVersion: versions.offerVersion,
})

const withdrawPlan = (deps: AdminMaturityOfferDeps) => (request: FastifyRequest): MutationPlan => {
  const own = ownOffer(request, parseOrThrow(withdrawOfferBodySchema, request.body))
  return {
    route: WITHDRAW_ROUTE,
    hash: own,
    execute: async (tx, actor) => ({
      status: 200,
      body: scheduleBody(deps, await withdrawMaturityOffer(tx, deps, { ...actor, ...own })),
    }),
  }
}

const toConfirmCommand = (body: ConfirmOfferBody, own: OwnOfferCommand): ConfirmMaturityOfferCommand => {
  switch (body.option) {
    case "return_all":
      return { ...own, option: body.option, effectiveDate: body.effectiveDate, amountPaise: BigInt(body.amountPaise) }
    case "one_time_and_sip":
      return {
        ...own,
        option: body.option,
        effectiveDate: body.effectiveDate,
        expectedPrincipalPaise: BigInt(body.expectedPrincipalPaise),
        expectedCurrentValuePaise: BigInt(body.expectedCurrentValuePaise),
      }
    case "sip_extension":
      return { ...own, option: body.option }
  }
}

const confirmPlan = (deps: AdminMaturityOfferDeps) => (request: FastifyRequest): MutationPlan => {
  const body = parseOrThrow(confirmOfferBodySchema, request.body)
  const own = ownOffer(request, body)
  return {
    route: CONFIRM_ROUTE,
    retention: "durable",
    hash: { ...body, ...own },
    execute: async (tx, actor) => ({
      status: 200,
      body: resolutionBody(deps, await confirmMaturityOffer(tx, deps, toConfirmCommand(body, { ...own, ...actor }))),
    }),
  }
}

export const registerAdminMaturityOfferRoutes = (application: FastifyInstance, deps: AdminMaturityOfferDeps): void => {
  application.post(SEND_ROUTE, (request, reply) => mutate(deps, request, reply, sendPlan(deps)))
  application.post(WITHDRAW_ROUTE, (request, reply) => mutate(deps, request, reply, withdrawPlan(deps)))
  application.post(CONFIRM_ROUTE, (request, reply) => mutate(deps, request, reply, confirmPlan(deps)))
}
