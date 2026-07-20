import pino from "pino"
import type { DestinationStream, LevelWithSilent, Logger } from "pino"

const REDACTION_PATHS = Object.freeze([
  "authorization",
  "body",
  "cookie",
  "email",
  "password",
  "pan",
  "phone",
  "providerPayload",
  "token",
  "refreshToken",
  "req.body",
  "req.headers.authorization",
  "req.headers.cookie",
  "res.headers.set-cookie",
  "user.email",
  "user.pan",
  "user.phone",
  "*.authorization",
  "*.cookie",
  "*.password",
  "*.token",
  "*.refreshToken",
])

export type RuntimeLoggerOptions = Readonly<{
  destination?: DestinationStream
  level: LevelWithSilent
}>

export const createRuntimeLogger = ({
  destination,
  level,
}: RuntimeLoggerOptions): Logger => {
  const options = {
    base: null,
    level,
    redact: {
      censor: "[REDACTED]",
      paths: [...REDACTION_PATHS],
    },
  }

  return destination === undefined ? pino(options) : pino(options, destination)
}
