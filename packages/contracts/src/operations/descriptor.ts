import type { z } from "zod"

import type { ErrorCode } from "../errors.js"

export const MAX_JSON_BODY_BYTES = 65_536

export type OperationSecurityPolicy =
  | Readonly<{
      authChannel: "public"
      credentialPolicy: "none"
      idempotency: "none" | "required"
      responseCacheControl?: never
    }>
  | Readonly<{
      authChannel: "public-token"
      credentialPolicy: "public-body-token"
      idempotency: "single-use-token"
      responseCacheControl?: never
    }>
  | Readonly<{
      authChannel: "native-activation"
      credentialPolicy: "native-body-token-only"
      idempotency: "single-use-token"
      responseCacheControl: "no-store"
    }>
  | Readonly<{
      authChannel: "native-login"
      credentialPolicy: "native-password-body-only"
      idempotency: "none"
      responseCacheControl: "no-store"
    }>
  | Readonly<{
      authChannel: "native-refresh"
      credentialPolicy: "native-refresh-token-body-only"
      idempotency: "deterministic-rotation"
      responseCacheControl: "no-store"
    }>
  | Readonly<{
      authChannel: "native-bearer"
      credentialPolicy: "native-bearer-and-refresh-body"
      idempotency: "naturally-idempotent"
      responseCacheControl: "no-store"
    }>

export type AuthChannel = OperationSecurityPolicy["authChannel"]
export type CredentialPolicy = OperationSecurityPolicy["credentialPolicy"]

type OperationBase = Readonly<{
  operationId: string
  method: "GET" | "POST"
  path: string
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

export type OperationInput = Readonly<OperationBase & OperationSecurityPolicy>

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
