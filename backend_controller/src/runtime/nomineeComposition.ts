import type { FastifyInstance } from "fastify"

import { createNomineeRequestRepository } from "../repositories/nomineeRequestRepository.js"
import { createUserNomineeRepository } from "../repositories/userNomineeRepository.js"
import { registerAdminNomineeRequestRoutes, type AdminNomineeRequestDeps } from "../routes/adminNomineeRequestRoutes.js"
import { registerAdminNomineeRoutes } from "../routes/adminNomineeRoutes.js"
import { registerClientNomineeRequestRoutes, type ClientNomineeRequestDeps } from "../routes/clientNomineeRequestRoutes.js"
import { registerClientNomineeRoutes } from "../routes/clientNomineeRoutes.js"

type NomineeRepositories = "nomineeRequestRepository" | "userNomineeRepository"

export type NomineeSurfaceDeps = Omit<AdminNomineeRequestDeps, NomineeRepositories | "config"> &
  Omit<ClientNomineeRequestDeps, NomineeRepositories | "config"> &
  Readonly<{ config: AdminNomineeRequestDeps["config"] }>

export const registerNomineeSurface = (application: FastifyInstance, deps: NomineeSurfaceDeps): void => {
  const surface = {
    ...deps,
    userNomineeRepository: createUserNomineeRepository(),
    nomineeRequestRepository: createNomineeRequestRepository(),
  }
  registerClientNomineeRoutes(application, surface)
  registerClientNomineeRequestRoutes(application, surface)
  registerAdminNomineeRoutes(application, surface)
  registerAdminNomineeRequestRoutes(application, surface)
}
