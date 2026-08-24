import { mkdir, writeFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"

import { OpenApiGeneratorV31, OpenAPIRegistry } from "@asteasolutions/zod-to-openapi"
import { z } from "zod"

import { ErrorEnvelope } from "../src/envelope.js"
import { ERROR_DEFINITIONS } from "../src/errors.js"
import type { ErrorCode } from "../src/errors.js"
import { ADMIN_FUND_AUM_OPERATIONS } from "../src/operations/admin-fund-aum.js"
import { NATIVE_AUTH_OPERATIONS } from "../src/operations/native-auth.js"
import { PUBLIC_OPERATIONS } from "../src/operations/public.js"

type GeneratableOperation = Readonly<{
  operationId: string
  method: "GET" | "POST" | "PATCH" | "DELETE"
  path: string
  request: Readonly<{
    body?: z.ZodType
    params?: z.ZodType
    query?: z.ZodType
    headers?: z.ZodType
    mediaType?: "application/json"
    maxBodyBytes?: number
  }>
  success: Readonly<{ status: 200 | 201 | 202; schema: z.ZodType }>
  errorCodes: readonly ErrorCode[]
}>

export const OPENAPI_INFO = Object.freeze({ title: "BeOnEdge API", version: "v1" })

export const ALL_OPERATIONS: readonly GeneratableOperation[] = Object.freeze([
  ...PUBLIC_OPERATIONS,
  ...NATIVE_AUTH_OPERATIONS,
  ...ADMIN_FUND_AUM_OPERATIONS,
])

type RouteConfig = Parameters<OpenAPIRegistry["registerPath"]>[0]
type ResponsesConfig = RouteConfig["responses"]
type RouteParameter = NonNullable<NonNullable<RouteConfig["request"]>["params"]>

type HeaderParameter = Readonly<{
  name: string
  in: "header"
  required: boolean
  schema: Readonly<{ type: "string" }>
}>

/**
 * Derive OpenAPI header parameters from an operation's Zod header object so the
 * generated contract documents modeled headers (e.g. the required
 * `idempotency-key` and the native `x-client-platform`/`x-app-version`). Names
 * are sorted for deterministic output; each header serializes as a string.
 */
const toHeaderParameters = (headers: z.ZodType | undefined): HeaderParameter[] => {
  if (!(headers instanceof z.ZodObject)) return []
  const shape: Record<string, z.ZodType> = headers.shape

  return Object.keys(shape)
    .sort()
    .map((name): HeaderParameter => {
      const field = shape[name]
      const required = !(field instanceof z.ZodOptional)
      return { name, in: "header", required, schema: { type: "string" } }
    })
}

const ErrorEnvelopeComponent = ErrorEnvelope.meta({ id: "ErrorEnvelope" })

export const buildOpenApiDocument = () => {
  const registry = new OpenAPIRegistry()

  for (const operation of ALL_OPERATIONS) {
    const errorStatuses = [
      ...new Set(operation.errorCodes.map((code) => ERROR_DEFINITIONS[code].httpStatus)),
    ].sort((left, right) => left - right)

    const responses: ResponsesConfig = {
      [operation.success.status]: {
        description: "Success",
        content: { "application/json": { schema: operation.success.schema } },
      },
    }
    for (const status of errorStatuses) {
      responses[status] = {
        description: "Error",
        content: { "application/json": { schema: ErrorEnvelopeComponent } },
      }
    }

    const method = operation.method.toLowerCase() as "get" | "post" | "patch" | "delete"
    const body = operation.request.body
    const params = operation.request.params
    const query = operation.request.query

    registry.registerPath({
      method,
      path: operation.path,
      operationId: operation.operationId,
      ...(body === undefined && params === undefined && query === undefined
        ? {}
        : {
            request: {
              ...(body === undefined
                ? {}
                : { body: { required: true, content: { "application/json": { schema: body } } } }),
              ...(params === undefined ? {} : { params: params as RouteParameter }),
              ...(query === undefined ? {} : { query: query as RouteParameter }),
            },
          }),
      responses,
    })
  }

  const generator = new OpenApiGeneratorV31(registry.definitions)
  const document = generator.generateDocument({ openapi: "3.1.0", info: { ...OPENAPI_INFO } })

  const paths = document.paths ?? {}
  for (const operation of ALL_OPERATIONS) {
    const headerParameters = toHeaderParameters(operation.request.headers)
    if (headerParameters.length === 0) continue

    const method = operation.method.toLowerCase() as "get" | "post" | "patch" | "delete"
    const operationObject = paths[operation.path]?.[method]
    if (operationObject === undefined) continue

    operationObject.parameters = [...(operationObject.parameters ?? []), ...headerParameters]
  }

  return document
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMainModule) {
  const document = buildOpenApiDocument()
  const serialized = `${JSON.stringify(document, null, 2)}\n`
  const generatedDirectory = new URL("../generated/", import.meta.url)
  await mkdir(generatedDirectory, { recursive: true })
  await writeFile(new URL("openapi-v1.json", generatedDirectory), serialized, "utf8")
}
