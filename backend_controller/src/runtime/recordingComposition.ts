import type { FastifyInstance } from "fastify"

import { createClientInvestedFundRepository } from "../repositories/clientInvestedFundRepository.js"
import { createClientReceiptRepository } from "../repositories/clientReceiptRepository.js"
import {
  registerAdminClientPositionRoutes,
  type AdminClientPositionConfig,
  type AdminClientPositionDeps,
} from "../routes/adminClientPositionRoutes.js"
import { registerClientInvestedFundRoutes } from "../routes/clientInvestedFundRoutes.js"
import { registerClientReceiptRoutes, type ClientReceiptConfig, type ClientReceiptDeps } from "../routes/clientReceiptRoutes.js"

export type RecordingSurfaceDeps = Omit<AdminClientPositionDeps, "config"> &
  Omit<ClientReceiptDeps, "config" | "clientReceiptRepository"> &
  Readonly<{ config: AdminClientPositionConfig & ClientReceiptConfig }>

export const registerRecordingSurface = (application: FastifyInstance, deps: RecordingSurfaceDeps): void => {
  registerAdminClientPositionRoutes(application, deps)
  registerClientReceiptRoutes(application, { ...deps, clientReceiptRepository: createClientReceiptRepository() })
  registerClientInvestedFundRoutes(application, { ...deps, clientInvestedFundRepository: createClientInvestedFundRepository() })
}
