import type { z } from "zod"

import type { ErrorCode } from "../errors.js"

export const MAX_JSON_BODY_BYTES = 65_536

export type AuthChannel = "public" | "public-token" | "native-activation"
export type CredentialPolicy = "none" | "public-body-token" | "native-body-token-only"

export type OperationInput = Readonly<{
  operationId: string
  method: "GET" | "POST"
  path: string
  authChannel: AuthChannel
  credentialPolicy: CredentialPolicy
  idempotency: "none" | "required" | "single-use-token"
  responseCacheControl?: "no-store"
  request: Readonly<{
    body?: z.ZodType
    headers?: z.ZodType
    mediaType?: "application/json"
    maxBodyBytes?: number
  }>
  success: Readonly<{
    status: 200 | 202
    schema: z.ZodType
  }>
  errorCodes: readonly ErrorCode[]
}>

export type FrozenOperation<TOperation extends OperationInput> = Readonly<
  Omit<TOperation, "request" | "success" | "errorCodes"> & {
    request: Readonly<TOperation["request"]>
    success: Readonly<TOperation["success"]>
    errorCodes: Readonly<TOperation["errorCodes"]>
  }
>

export const defineOperation = <const TOperation extends OperationInput>(
  operation: TOperation,
): FrozenOperation<TOperation> => {
  const frozenOperation = Object.freeze({
    ...operation,
    request: Object.freeze({ ...operation.request }),
    success: Object.freeze({ ...operation.success }),
    errorCodes: Object.freeze([...operation.errorCodes]),
  })

  return frozenOperation as FrozenOperation<TOperation>
}
