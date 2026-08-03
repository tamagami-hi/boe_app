import fastify, { LogController } from "fastify"
import type { DestinationStream, LevelWithSilent, Logger } from "pino"
import type { FastifyBaseLogger, FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify"

import { MAX_JSON_BODY_BYTES, registerHttpBoundary, renderError } from "../http/boundary.js"
import { registerCors } from "../http/cors.js"

import { createRuntimeLogger } from "./logger.js"

export const LIVE_RESPONSE = Object.freeze({ status: "ok" as const })

type ApplicationOptions = Readonly<{
  destination?: DestinationStream
  level?: LevelWithSilent
  logger?: Logger | false
  registerRoutes?: (application: FastifyInstance) => void
  /**
   * Origins allowed to call this API from a browser. Defaults to empty, which
   * emits no CORS headers — correct for tests and for same-origin deployments.
   */
  corsAllowlist?: readonly string[]
}>

const createFastifyInstance = ({
  destination,
  level = "info",
  logger,
}: ApplicationOptions): FastifyInstance => {
  const commonOptions = {
    exposeHeadRoutes: false,
    bodyLimit: MAX_JSON_BODY_BYTES,
    frameworkErrors: (error: FastifyError, request: FastifyRequest, reply: FastifyReply) =>
      renderError(error, request, reply),
    logController: new LogController({ disableRequestLogging: true }),
  }

  if (logger === false) return fastify({ ...commonOptions, logger: false })

  const loggerInstance: FastifyBaseLogger =
    logger ??
    (destination === undefined
      ? createRuntimeLogger({ level })
      : createRuntimeLogger({ destination, level }))
  return fastify({ ...commonOptions, loggerInstance })
}

export const createApplication = (options: ApplicationOptions = {}): FastifyInstance => {
  const application = createFastifyInstance(options)

  registerHttpBoundary(application)
  registerCors(application, options.corsAllowlist ?? [])

  application.get("/health/live", () => LIVE_RESPONSE)
  options.registerRoutes?.(application)

  return application
}
