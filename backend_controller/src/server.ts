import { pathToFileURL } from "node:url"

import type { FastifyInstance } from "fastify"
import type { Logger } from "pino"

import { createApplication } from "./runtime/application.js"
import {
  parseRuntimeEnvironment,
  type RuntimeEnvironment,
} from "./runtime/environment.js"
import { createRuntimeLogger } from "./runtime/logger.js"
import { registerGracefulShutdown } from "./runtime/shutdown.js"

type StartServerOptions = Readonly<{
  environment?: RuntimeEnvironment
  logger?: Logger
}>

export const startServer = async ({
  environment = parseRuntimeEnvironment(process.env),
  logger = createRuntimeLogger({ level: environment.logLevel }),
}: StartServerOptions = {}): Promise<FastifyInstance> => {
  const application = createApplication({ logger })
  await application.listen({ host: environment.host, port: environment.port })
  logger.info({ host: environment.host, port: environment.port }, "Backend listening")
  return application
}

const isMainModule = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMainModule) {
  const environment = parseRuntimeEnvironment(process.env)
  const logger = createRuntimeLogger({ level: environment.logLevel })

  void startServer({ environment, logger })
    .then((application) => {
      registerGracefulShutdown({ application, logger })
    })
    .catch(() => {
      logger.error({ errorCode: "BACKEND_STARTUP_FAILURE" }, "Backend startup failed")
      process.exitCode = 1
    })
}
