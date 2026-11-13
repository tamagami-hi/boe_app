import type { FastifyInstance } from "fastify"

import { createClientMaturityOfferRepository } from "../repositories/clientMaturityOfferRepository.js"
import { createClientMaturityScheduleRepository } from "../repositories/clientMaturityScheduleRepository.js"
import { registerAdminMaturityOfferRoutes, type AdminMaturityOfferDeps } from "../routes/adminMaturityOfferRoutes.js"
import { registerAdminMaturityScheduleRoutes } from "../routes/adminMaturityScheduleRoutes.js"
import { registerClientMaturityOfferRoutes, type ClientMaturityOfferDeps } from "../routes/clientMaturityOfferRoutes.js"

export type MaturitySurfaceDeps = Omit<AdminMaturityOfferDeps, "maturityScheduleRepository" | "maturityOfferRepository"> &
  Omit<ClientMaturityOfferDeps, "config" | "maturityOfferRepository">

export const registerMaturitySurface = (application: FastifyInstance, deps: MaturitySurfaceDeps): void => {
  const repositories = {
    maturityScheduleRepository: createClientMaturityScheduleRepository(),
    maturityOfferRepository: createClientMaturityOfferRepository(),
  }
  const adminDeps = { ...deps, ...repositories }
  registerAdminMaturityScheduleRoutes(application, adminDeps)
  registerAdminMaturityOfferRoutes(application, adminDeps)
  registerClientMaturityOfferRoutes(application, adminDeps)
}
