import { z } from "zod"
import { describe, expect, expectTypeOf, it } from "vitest"

import * as Contracts from "../index.js"
import { ERROR_DEFINITIONS, ErrorCode } from "../errors.js"
import * as ActivationContracts from "./activation.js"
import type { OperationInput, OperationSecurityPolicy } from "./descriptor.js"
import {
  NATIVE_AUTH_OPERATIONS,
  NativeAuthHeaders,
  NativeLoginBody,
  NativeLoginData,
  NativeLoginSuccessEnvelope,
  NativeLogoutBody,
  NativeLogoutData,
  NativeLogoutHeaders,
  NativeLogoutSuccessEnvelope,
  NativeRefreshBody,
  NativeRefreshData,
  NativeRefreshSuccessEnvelope,
  nativeLogin,
  nativeLogout,
  nativeRefresh,
} from "./native-auth.js"
import * as PublicContracts from "./public.js"

const UUID = "123e4567-e89b-42d3-a456-426614174000"
const TOKEN = "t".repeat(43)
const PASSWORD = "correct horse battery staple"
const ACCESS_TOKEN = `${"a".repeat(40)}.${"b".repeat(40)}.${"c".repeat(40)}`

const createHeaders = () => ({
  "x-client-platform": "android",
  "x-app-version": "1.2.3",
})

const createDevice = () => ({
  installationId: UUID,
  name: "Pixel 9",
  platform: "android",
  appVersion: "1.2.3",
})

const createCredentialData = () => ({
  accessToken: ACCESS_TOKEN,
  accessTokenExpiresAt: "2026-07-20T16:00:00+05:30",
  refreshToken: TOKEN,
  refreshTokenExpiresAt: "2026-08-20T16:00:00+05:30",
  sessionId: UUID,
})

const createSessionData = () => ({
  user: {
    userId: UUID,
    fullName: "Ada Lovelace",
    email: "ada@example.com",
    phoneMasked: "+91******3210",
    accountStatus: "active",
  },
  ...createCredentialData(),
})

const expectRejectedCases = (
  schema: { safeParse: (value: unknown) => { success: boolean } },
  cases: ReadonlyArray<readonly [label: string, value: unknown]>,
) => {
  for (const [label, value] of cases) {
    expect(schema.safeParse(value).success, label).toBe(false)
  }
}

describe("native authentication operation descriptors", () => {
  it("defines the exact ordered native authentication group", () => {
    expect(NATIVE_AUTH_OPERATIONS).toEqual([nativeLogin, nativeRefresh, nativeLogout])
    expect(nativeLogin).toMatchObject({
      operationId: "nativeLogin",
      method: "POST",
      path: "/v1/auth/native/login",
      authChannel: "native-login",
      credentialPolicy: "native-password-body-only",
      idempotency: "none",
      responseCacheControl: "no-store",
      request: { mediaType: "application/json", maxBodyBytes: 65_536 },
      success: { status: 200 },
      errorCodes: [
        "VALIDATION_FAILED",
        "INVALID_CREDENTIALS",
        "STATE_CONFLICT",
        "PAYLOAD_TOO_LARGE",
        "UNSUPPORTED_MEDIA_TYPE",
        "RATE_LIMITED",
        "INTERNAL_ERROR",
        "DEPENDENCY_UNAVAILABLE",
      ],
    })
    expect(nativeRefresh).toMatchObject({
      operationId: "refreshNativeSession",
      method: "POST",
      path: "/v1/auth/native/refresh",
      authChannel: "native-refresh",
      credentialPolicy: "native-refresh-token-body-only",
      idempotency: "deterministic-rotation",
      responseCacheControl: "no-store",
      request: { mediaType: "application/json", maxBodyBytes: 65_536 },
      success: { status: 200 },
      errorCodes: [
        "VALIDATION_FAILED",
        "SESSION_INVALID",
        "PAYLOAD_TOO_LARGE",
        "UNSUPPORTED_MEDIA_TYPE",
        "RATE_LIMITED",
        "INTERNAL_ERROR",
        "DEPENDENCY_UNAVAILABLE",
      ],
    })
    expect(nativeLogout).toMatchObject({
      operationId: "logoutNativeSession",
      method: "POST",
      path: "/v1/auth/native/logout",
      authChannel: "native-bearer",
      credentialPolicy: "native-bearer-and-refresh-body",
      idempotency: "naturally-idempotent",
      responseCacheControl: "no-store",
      request: { mediaType: "application/json", maxBodyBytes: 65_536 },
      success: { status: 200 },
      errorCodes: [
        "VALIDATION_FAILED",
        "AUTHENTICATION_REQUIRED",
        "SESSION_INVALID",
        "PAYLOAD_TOO_LARGE",
        "UNSUPPORTED_MEDIA_TYPE",
        "RATE_LIMITED",
        "INTERNAL_ERROR",
        "DEPENDENCY_UNAVAILABLE",
      ],
    })
  })

  it("keeps the shared security and idempotency vocabularies closed", () => {
    expectTypeOf<OperationInput["authChannel"]>().toEqualTypeOf<
      | "public"
      | "public-token"
      | "native-activation"
      | "native-login"
      | "native-refresh"
      | "native-bearer"
    >()
    expectTypeOf<OperationInput["idempotency"]>().toEqualTypeOf<
      | "none"
      | "required"
      | "single-use-token"
      | "deterministic-rotation"
      | "naturally-idempotent"
    >()
    expectTypeOf<
      Extract<
        OperationInput,
        { authChannel: "native-login"; credentialPolicy: "native-refresh-token-body-only" }
      >
    >().toEqualTypeOf<never>()
    expectTypeOf<
      Extract<OperationInput, { authChannel: "native-refresh" }>["responseCacheControl"]
    >().toEqualTypeOf<"no-store">()
    expectTypeOf<
      {
        authChannel: "native-refresh"
        credentialPolicy: "native-refresh-token-body-only"
        idempotency: "required"
        responseCacheControl: "no-store"
      } extends OperationSecurityPolicy
        ? true
        : false
    >().toEqualTypeOf<false>()
  })

  it("preserves exact request schemas and deeply immutable policy", () => {
    const loginBody: typeof NativeLoginBody = nativeLogin.request.body
    const loginHeaders: typeof NativeAuthHeaders = nativeLogin.request.headers
    const refreshBody: typeof NativeRefreshBody = nativeRefresh.request.body
    const refreshHeaders: typeof NativeAuthHeaders = nativeRefresh.request.headers
    const logoutBody: typeof NativeLogoutBody = nativeLogout.request.body
    const logoutHeaders: typeof NativeLogoutHeaders = nativeLogout.request.headers

    expect(loginBody).toBe(NativeLoginBody)
    expect(loginHeaders).toBe(NativeAuthHeaders)
    expect(refreshBody).toBe(NativeRefreshBody)
    expect(refreshHeaders).toBe(NativeAuthHeaders)
    expect(logoutBody).toBe(NativeLogoutBody)
    expect(logoutHeaders).toBe(NativeLogoutHeaders)
    expectTypeOf<keyof typeof nativeLogin.request>().toEqualTypeOf<
      "body" | "headers" | "mediaType" | "maxBodyBytes"
    >()
    expectTypeOf<keyof typeof nativeRefresh.request>().toEqualTypeOf<
      "body" | "headers" | "mediaType" | "maxBodyBytes"
    >()
    expectTypeOf<keyof typeof nativeLogout.request>().toEqualTypeOf<
      "body" | "headers" | "mediaType" | "maxBodyBytes"
    >()
    expect(Object.isFrozen(NATIVE_AUTH_OPERATIONS)).toBe(true)
    for (const operation of NATIVE_AUTH_OPERATIONS) {
      expect(Object.isFrozen(operation)).toBe(true)
      expect(Object.isFrozen(operation.request)).toBe(true)
      expect(Object.isFrozen(operation.success)).toBe(true)
      expect(Object.isFrozen(operation.errorCodes)).toBe(true)
      for (const code of operation.errorCodes) {
        expect(ErrorCode.parse(code)).toBe(code)
        expect(ERROR_DEFINITIONS[code]).toBeDefined()
      }
    }
  })

  it("keeps route identities unique and package surfaces isolated", () => {
    const operations = [
      ...PublicContracts.PUBLIC_OPERATIONS,
      ...ActivationContracts.ACTIVATION_OPERATIONS,
      ...NATIVE_AUTH_OPERATIONS,
    ]
    const operationIds = operations.map(({ operationId }) => operationId)
    const routes = operations.map(({ method, path }) => `${method} ${path}`)

    expect(new Set(operationIds).size).toBe(operationIds.length)
    expect(new Set(routes).size).toBe(routes.length)
    expect(Contracts.NATIVE_AUTH_OPERATIONS).toBe(NATIVE_AUTH_OPERATIONS)
    expect("NATIVE_AUTH_OPERATIONS" in PublicContracts).toBe(false)
    expect("NATIVE_AUTH_OPERATIONS" in ActivationContracts).toBe(false)
  })
})

describe("native login contract", () => {
  it("accepts strict normalized credentials and native device input", () => {
    const body = {
      email: "ada@example.com",
      password: ` ${PASSWORD}`,
      device: { ...createDevice(), name: "  Pixel 9  " },
    }
    expect(NativeLoginBody.parse(body)).toEqual({
      email: "ada@example.com",
      password: ` ${PASSWORD}`,
      device: createDevice(),
    })
    expect(NativeAuthHeaders.parse(createHeaders())).toEqual(createHeaders())
  })

  it("rejects ambiguous credentials, account-state input, and non-native projections", () => {
    const body = { email: "ada@example.com", password: PASSWORD, device: createDevice() }
    expectRejectedCases(NativeLoginBody, [
      ["invalid email", { ...body, email: "not-an-email" }],
      ["short password", { ...body, password: "short" }],
      ["account state input", { ...body, accountStatus: "active" }],
      ["unknown device field", { ...body, device: { ...body.device, deviceIdHash: "redacted" } }],
    ])
    expectRejectedCases(NativeAuthHeaders, [
      ["cookie projection", { ...createHeaders(), cookie: "redacted" }],
      ["bearer projection", { ...createHeaders(), authorization: "redacted" }],
      ["wrong platform", { ...createHeaders(), "x-client-platform": "web" }],
    ])
    expect(nativeLogin.errorCodes).toContain("INVALID_CREDENTIALS")
    expect(nativeLogin.errorCodes).not.toContain("ACCOUNT_NOT_ACTIVE")
    expect(nativeLogin.errorCodes).toContain("STATE_CONFLICT")
  })

  it("reuses the exact activation session result without leaking credentials", () => {
    expect(NativeLoginData).toBe(ActivationContracts.CompleteActivationData)
    expect(NativeLoginSuccessEnvelope).toBe(
      ActivationContracts.CompleteActivationSuccessEnvelope,
    )
    const parsed = NativeLoginData.parse(createSessionData())
    expect(parsed.user.accountStatus).toBe("active")
    expectRejectedCases(NativeLoginData, [
      ["password leakage", { ...createSessionData(), password: PASSWORD }],
      ["device leakage", { ...createSessionData(), device: createDevice() }],
      ["role leakage", { ...createSessionData(), roles: ["admin"] }],
    ])
  })
})

describe("native refresh contract", () => {
  it("requires one opaque refresh token and client rotation UUID", () => {
    expect(NativeRefreshBody.parse({ refreshToken: TOKEN, rotationId: UUID })).toEqual({
      refreshToken: TOKEN,
      rotationId: UUID,
    })
    expectRejectedCases(NativeRefreshBody, [
      ["short token", { refreshToken: "t".repeat(42), rotationId: UUID }],
      ["padded token", { refreshToken: `${"t".repeat(42)}=`, rotationId: UUID }],
      ["missing rotation", { refreshToken: TOKEN }],
      ["invalid rotation", { refreshToken: TOKEN, rotationId: "not-a-uuid" }],
      ["unknown field", { refreshToken: TOKEN, rotationId: UUID, replay: true }],
    ])
  })

  it("returns only the strict successor credential/session subset", () => {
    const credentials = createCredentialData()
    const parsed = NativeRefreshData.parse(credentials)
    expect(parsed.accessTokenExpiresAt).toBe("2026-07-20T10:30:00.000Z")
    expect(parsed.refreshTokenExpiresAt).toBe("2026-08-20T10:30:00.000Z")
    expectRejectedCases(NativeRefreshData, [
      ["user echo", { ...credentials, user: createSessionData().user }],
      ["rotation echo", { ...credentials, rotationId: UUID }],
      ["short access token", { ...credentials, accessToken: "a".repeat(99) }],
    ])
  })
})

describe("native logout contract", () => {
  it("projects only compatibility headers while descriptor policy requires bearer auth", () => {
    expect(NativeLogoutHeaders.parse(createHeaders())).toEqual(createHeaders())
    expect(NativeLogoutBody.parse({ refreshToken: TOKEN })).toEqual({ refreshToken: TOKEN })
    expectRejectedCases(NativeLogoutHeaders, [
      ["bearer projection", { ...createHeaders(), authorization: `Bearer ${ACCESS_TOKEN}` }],
      ["cookie projection", { ...createHeaders(), cookie: "redacted" }],
    ])
    expect(nativeLogout.authChannel).toBe("native-bearer")
    expect(nativeLogout.credentialPolicy).toBe("native-bearer-and-refresh-body")
  })

  it("returns only the naturally idempotent success literal", () => {
    expect(NativeLogoutData.parse({ loggedOut: true })).toEqual({ loggedOut: true })
    expectRejectedCases(NativeLogoutData, [
      ["false logout", { loggedOut: false }],
      ["session leakage", { loggedOut: true, sessionId: UUID }],
    ])
    expect(
      NativeLogoutSuccessEnvelope.parse({
        ok: true,
        data: { loggedOut: true },
        error: null,
        meta: { requestId: UUID, timestamp: "2026-07-20T10:30:00Z" },
      }).data,
    ).toEqual({ loggedOut: true })
  })
})

describe("native authentication secret and JSON Schema boundaries", () => {
  it("does not echo rejected password or refresh inputs in issues", () => {
    const syntheticPasswordSecret = `password\u0000secret`
    const syntheticRefreshSecret = `!${"r".repeat(42)}`
    const results = [
      [
        NativeLoginBody.safeParse({
          email: "ada@example.com",
          password: syntheticPasswordSecret,
          device: createDevice(),
        }),
        syntheticPasswordSecret,
      ],
      [
        NativeRefreshBody.safeParse({ refreshToken: syntheticRefreshSecret, rotationId: UUID }),
        syntheticRefreshSecret,
      ],
    ] as const

    for (const [result, secret] of results) {
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(JSON.stringify(result.error.issues)).not.toContain(secret)
      }
    }
  })

  it("emits strict input/output schemas with credential constraints", () => {
    for (const [schema, io] of [
      [NativeLoginBody, "input"],
      [NativeRefreshBody, "input"],
      [NativeLogoutBody, "input"],
      [NativeLogoutHeaders, "input"],
      [NativeRefreshData, "output"],
      [NativeRefreshSuccessEnvelope, "output"],
      [NativeLogoutData, "output"],
      [NativeLogoutSuccessEnvelope, "output"],
    ] as const) {
      expect(JSON.stringify(z.toJSONSchema(schema, { io }))).toContain(
        '"additionalProperties":false',
      )
    }
    const refresh = JSON.stringify(z.toJSONSchema(NativeRefreshBody, { io: "input" }))
    expect(refresh).toContain('"pattern":"^[A-Za-z0-9_-]{43}$"')
    expect(JSON.stringify(z.toJSONSchema(NativeLogoutHeaders, { io: "input" }))).toContain(
      '"const":"android"',
    )
  })
})
