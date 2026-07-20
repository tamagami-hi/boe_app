import fastify, { LogController } from "fastify"
import type { DestinationStream, LevelWithSilent, Logger } from "pino"
import type {
  FastifyBaseLogger,
  FastifyError,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify"

import { createRuntimeLogger } from "./logger.js"

export const LIVE_RESPONSE = Object.freeze({ status: "ok" as const })

const NOT_FOUND_RESPONSE = Object.freeze({
  error: Object.freeze({
    code: "RESOURCE_NOT_FOUND" as const,
    message: "Resource not found",
    retryable: false,
  }),
})

const INTERNAL_ERROR_RESPONSE = Object.freeze({
  error: Object.freeze({
    code: "INTERNAL_ERROR" as const,
    message: "Internal server error",
    retryable: true,
  }),
})

const VALIDATION_ERROR_RESPONSE = Object.freeze({
  error: Object.freeze({
    code: "VALIDATION_FAILED" as const,
    message: "Request validation failed",
    retryable: false,
  }),
})

type ApplicationOptions = Readonly<{
  destination?: DestinationStream
  level?: LevelWithSilent
  logger?: Logger | false
  registerRoutes?: (application: FastifyInstance) => void
}>

const createFastifyInstance = ({
  destination,
  level = "info",
  logger,
}: ApplicationOptions): FastifyInstance => {
  const commonOptions = {
    exposeHeadRoutes: false,
    frameworkErrors: (
      _error: FastifyError,
      _request: FastifyRequest,
      reply: FastifyReply,
    ) => reply.status(400).send(VALIDATION_ERROR_RESPONSE),
    logController: new LogController({ disableRequestLogging: true }),
  }

  if (logger === false) return fastify({ ...commonOptions, logger: false })

  const loggerInstance: FastifyBaseLogger = logger ?? (destination === undefined
    ? createRuntimeLogger({ level })
    : createRuntimeLogger({ destination, level }))
  return fastify({ ...commonOptions, loggerInstance })
}

export const createApplication = (options: ApplicationOptions = {}): FastifyInstance => {
  const application = createFastifyInstance(options)

  application.addHook("onSend", async (_request, reply, payload) => {
    reply.header("cache-control", "no-store")
    reply.header("x-content-type-options", "nosniff")
    return payload
  })

  application.setNotFoundHandler(async (_request, reply) => {
    return reply.status(404).send(NOT_FOUND_RESPONSE)
  })

  application.setErrorHandler(async (error, request, reply) => {
    request.log.error(
      { errorCode: "UNEXPECTED_REQUEST_FAILURE", requestId: request.id },
      "Request failed unexpectedly",
    )
    return reply.status(500).send(INTERNAL_ERROR_RESPONSE)
  })

  application.get("/health/live", () => LIVE_RESPONSE)
  options.registerRoutes?.(application)

  return application
}
