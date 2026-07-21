/**
 * Fastify HTTP boundary wiring (spec 04 §2.2, §2.4, §3). Installs request-id
 * resolution, the canonical response envelope (`reply.sendData`), the error and
 * not-found renderers that map every failure to a stable `ErrorCode`, and the
 * shared security headers. Body-size and media-type limits are enforced by the
 * Fastify instance options in `runtime/application.ts` and rendered here.
 */
import { randomUUID } from "node:crypto"

import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify"

import { AppError, type ErrorCode } from "./errorCatalog.js"
import { errorEnvelope, successEnvelope, type PageMeta } from "./envelope.js"

export const MAX_JSON_BODY_BYTES = 65_536

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

declare module "fastify" {
  interface FastifyRequest {
    requestId: string
  }
  interface FastifyReply {
    sendData: <TData>(
      data: TData,
      options?: {
        readonly status?: number
        readonly idempotencyReplay?: boolean
        readonly page?: PageMeta
      },
    ) => FastifyReply
  }
}

/** Resolve the request id from a valid incoming `X-Request-Id` or a fresh UUID. */
export const resolveRequestId = (headerValue: string | string[] | undefined): string => {
  const candidate = Array.isArray(headerValue) ? headerValue[0] : headerValue
  return candidate !== undefined && UUID_PATTERN.test(candidate) ? candidate : randomUUID()
}

interface ResolvedError {
  readonly code: ErrorCode
  readonly message: string
  readonly fields?: Readonly<Record<string, readonly string[]>>
  readonly retryable: boolean
  readonly httpStatus: number
  readonly retryAfterSeconds?: number
  readonly isUnexpected: boolean
}

const isZodError = (error: unknown): error is { issues: { path: (string | number)[]; message: string }[] } =>
  typeof error === "object" &&
  error !== null &&
  Array.isArray((error as { issues?: unknown }).issues)

const zodFields = (issues: { path: (string | number)[]; message: string }[]): Record<string, string[]> => {
  const fields: Record<string, string[]> = {}
  for (const issue of issues) {
    const key = issue.path.length === 0 ? "_root" : issue.path.map((part) => String(part)).join(".")
    ;(fields[key] ??= []).push(issue.message)
  }
  return fields
}

/** Map any thrown value to a public code without leaking internal detail. */
const resolveError = (error: unknown): ResolvedError => {
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.fields === undefined ? {} : { fields: error.fields }),
      retryable: error.retryable,
      httpStatus: error.httpStatus,
      ...(error.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: error.retryAfterSeconds }),
      isUnexpected: false,
    }
  }

  if (isZodError(error)) {
    return {
      code: "VALIDATION_FAILED",
      message: "Request validation failed",
      fields: zodFields(error.issues),
      retryable: false,
      httpStatus: 400,
      isUnexpected: false,
    }
  }

  const framework = error as Partial<FastifyError>
  const frameworkCode = typeof framework.code === "string" ? framework.code : ""
  const statusCode = typeof framework.statusCode === "number" ? framework.statusCode : 0

  if (frameworkCode === "FST_ERR_CTP_BODY_TOO_LARGE" || statusCode === 413) {
    return renderKnown("PAYLOAD_TOO_LARGE")
  }
  if (frameworkCode === "FST_ERR_CTP_INVALID_MEDIA_TYPE" || statusCode === 415) {
    return renderKnown("UNSUPPORTED_MEDIA_TYPE")
  }
  if (frameworkCode.startsWith("FST_ERR_VALIDATION") || frameworkCode === "FST_ERR_CTP_EMPTY_JSON_BODY" || statusCode === 400) {
    return renderKnown("VALIDATION_FAILED")
  }

  return { ...renderKnown("INTERNAL_ERROR"), isUnexpected: true }
}

const renderKnown = (code: ErrorCode): ResolvedError => {
  const appError = new AppError(code)
  return {
    code: appError.code,
    message: appError.message,
    retryable: appError.retryable,
    httpStatus: appError.httpStatus,
    isUnexpected: false,
  }
}

/** Render any error as the canonical ErrorEnvelope; redact unexpected failures. */
export const renderError = (error: unknown, request: FastifyRequest, reply: FastifyReply): FastifyReply => {
  const resolved = resolveError(error)
  const requestId = request.requestId !== "" ? request.requestId : resolveRequestId(undefined)

  if (resolved.isUnexpected) {
    request.log.error({ errorCode: "UNEXPECTED_REQUEST_FAILURE", requestId }, "Request failed unexpectedly")
  }
  if (resolved.retryAfterSeconds !== undefined) {
    reply.header("retry-after", String(resolved.retryAfterSeconds))
  }

  return reply.status(resolved.httpStatus).send(
    errorEnvelope(
      {
        code: resolved.code,
        message: resolved.message,
        ...(resolved.fields === undefined ? {} : { fields: resolved.fields }),
        retryable: resolved.retryable,
      },
      { requestId },
    ),
  )
}

function sendData(
  this: FastifyReply,
  data: unknown,
  options: {
    readonly status?: number
    readonly idempotencyReplay?: boolean
    readonly page?: PageMeta
  } = {},
): FastifyReply {
  const status = options.status ?? this.statusCode
  return this.status(status).send(
    successEnvelope(data, {
      requestId: this.request.requestId,
      ...(options.idempotencyReplay === undefined ? {} : { idempotencyReplay: options.idempotencyReplay }),
      ...(options.page === undefined ? {} : { page: options.page }),
    }),
  )
}

/** Install the boundary hooks, decorators, and handlers on a Fastify instance. */
export const registerHttpBoundary = (application: FastifyInstance): void => {
  application.decorateRequest("requestId", "")
  application.decorateReply("sendData", sendData)

  application.addHook("onRequest", (request, reply, done) => {
    request.requestId = resolveRequestId(request.headers["x-request-id"])
    reply.header("x-request-id", request.requestId)
    done()
  })

  application.addHook("onSend", (_request, reply, payload, done) => {
    reply.header("cache-control", "no-store")
    reply.header("x-content-type-options", "nosniff")
    done(null, payload)
  })

  application.setNotFoundHandler((request, reply) => {
    renderError(new AppError("RESOURCE_NOT_FOUND"), request, reply)
  })

  application.setErrorHandler((error, request, reply) => {
    renderError(error, request, reply)
  })
}
