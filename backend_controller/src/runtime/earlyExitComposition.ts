import type { FastifyInstance } from "fastify"

import { createClientMaturityOfferRepository } from "../repositories/clientMaturityOfferRepository.js"
import { createClientMaturityScheduleRepository } from "../repositories/clientMaturityScheduleRepository.js"
import { createSipEarlyExitRepository } from "../repositories/earlyExitRepository.js"
import { registerAdminSipEarlyExitRoutes, type AdminSipEarlyExitDeps } from "../routes/adminEarlyExitRoutes.js"
import { registerClientSipEarlyExitRoutes, type ClientSipEarlyExitDeps } from "../routes/clientEarlyExitRoutes.js"

export type SipEarlyExitSurfaceDeps = Omit<
  AdminSipEarlyExitDeps,
  "maturityScheduleRepository" | "maturityOfferRepository" | "sipEarlyExitRepository"
> &
  Omit<ClientSipEarlyExitDeps, "sipEarlyExitRepository">

export const registerSipEarlyExitSurface = (application: FastifyInstance, deps: SipEarlyExitSurfaceDeps): void => {
  const routeDeps = {
    ...deps,
    maturityScheduleRepository: createClientMaturityScheduleRepository(),
    maturityOfferRepository: createClientMaturityOfferRepository(),
    sipEarlyExitRepository: createSipEarlyExitRepository(),
  }
  registerAdminSipEarlyExitRoutes(application, routeDeps)
  registerClientSipEarlyExitRoutes(application, routeDeps)
}
