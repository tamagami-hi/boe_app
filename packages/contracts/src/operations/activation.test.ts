import { z } from "zod"
import { describe, expect, expectTypeOf, it } from "vitest"

import * as Contracts from "../index.js"
import { ERROR_DEFINITIONS, ErrorCode } from "../errors.js"
import {
  ACTIVATION_OPERATIONS,
  AppVersion,
  CompleteActivationBody,
  CompleteActivationData,
  CompleteActivationHeaders,
  CompleteActivationSuccessEnvelope,
  completeActivation,
  PhoneMasked,
} from "./activation.js"
import type { OperationInput } from "./descriptor.js"
import * as PublicContracts from "./public.js"

const UUID = "123e4567-e89b-42d3-a456-426614174000"
const TOKEN = "a".repeat(43)
const ACCESS_TOKEN = "a".repeat(100)
const PASSWORD = "correct horse battery staple"

const createBody = () => ({
  token: TOKEN,
  password: PASSWORD,
  device: {
    installationId: UUID,
    name: "Pixel 9",
    platform: "android",
    appVersion: "1.2.3",
  },
})
const createData = () => ({
  user: {
    userId: UUID,
    fullName: "Ada Lovelace",
    email: "ada@example.com",
    phoneMasked: "+91******3210",
    accountStatus: "active",
  },
  accessToken: ACCESS_TOKEN,
  accessTokenExpiresAt: "2026-07-20T16:00:00+05:30",
  refreshToken: TOKEN,
  refreshTokenExpiresAt: "2026-08-20T16:00:00+05:30",
  sessionId: UUID,
})

const expectRejectedCases = (
  schema: { safeParse: (value: unknown) => { success: boolean } },
  cases: ReadonlyArray<readonly [label: string, value: unknown]>,
) => {
  for (const [label, value] of cases) {
    expect(schema.safeParse(value).success, label).toBe(false)
  }
}

describe("activation operation descriptor", () => {
  it("defines the exact native-only single-use operation", () => {
    expect(ACTIVATION_OPERATIONS).toEqual([completeActivation])
    expect(completeActivation).toMatchObject({
      operationId: "completeActivation",
      method: "POST",
      path: "/v1/activations/complete",
      authChannel: "native-activation",
      credentialPolicy: "native-body-token-only",
      idempotency: "single-use-token",
      responseCacheControl: "no-store",
      request: { mediaType: "application/json", maxBodyBytes: 65_536 },
      success: { status: 200 },
      errorCodes: [
        "VALIDATION_FAILED",
        "TOKEN_INVALID",
        "STATE_CONFLICT",
        "TOKEN_ALREADY_USED",
        "TOKEN_EXPIRED",
        "PAYLOAD_TOO_LARGE",
        "UNSUPPORTED_MEDIA_TYPE",
        "RATE_LIMITED",
        "INTERNAL_ERROR",
        "DEPENDENCY_UNAVAILABLE",
      ],
    })
    expect(completeActivation.success).not.toHaveProperty("cacheControl")
  })

  it("keeps shared auth and response policy types closed", () => {
    expectTypeOf<OperationInput["authChannel"]>().toEqualTypeOf<
      "public" | "public-token" | "native-activation"
    >()
    expectTypeOf<OperationInput["credentialPolicy"]>().toEqualTypeOf<
      "none" | "public-body-token" | "native-body-token-only"
    >()
    expectTypeOf<OperationInput["success"]["status"]>().toEqualTypeOf<200 | 202>()
  })

  it("preserves the exact activation request schema types", () => {
    const bodySchema: typeof CompleteActivationBody = completeActivation.request.body
    const headerSchema: typeof CompleteActivationHeaders = completeActivation.request.headers

    expect(bodySchema).toBe(CompleteActivationBody)
    expect(headerSchema).toBe(CompleteActivationHeaders)
    expectTypeOf<keyof typeof completeActivation.request>().toEqualTypeOf<
      "body" | "headers" | "mediaType" | "maxBodyBytes"
    >()
  })

  it("keeps descriptor policy deeply frozen and canonical", () => {
    expect(Object.isFrozen(ACTIVATION_OPERATIONS)).toBe(true)
    expect(Object.isFrozen(completeActivation)).toBe(true)
    expect(Object.isFrozen(completeActivation.request)).toBe(true)
    expect(Object.isFrozen(completeActivation.success)).toBe(true)
    expect(Object.isFrozen(completeActivation.errorCodes)).toBe(true)

    for (const code of completeActivation.errorCodes) {
      expect(ErrorCode.parse(code)).toBe(code)
      expect(ERROR_DEFINITIONS[code]).toBeDefined()
    }
    for (const forbidden of [
      "AUTHENTICATION_REQUIRED",
      "ACTIVE_APPLICATION_EXISTS",
      "IDEMPOTENCY_KEY_REUSED",
      "IDEMPOTENCY_IN_PROGRESS",
    ]) {
      expect(completeActivation.errorCodes).not.toContain(forbidden)
    }
  })

  it("preserves route uniqueness across operation groups", () => {
    const operations = [...PublicContracts.PUBLIC_OPERATIONS, ...ACTIVATION_OPERATIONS]
    const ids = operations.map(({ operationId }) => operationId)
    const routes = operations.map(({ method, path }) => `${method} ${path}`)

    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(routes).size).toBe(routes.length)
  })

  it("exports activation contracts from root without leaking through public", () => {
    expect(Contracts.ACTIVATION_OPERATIONS).toBe(ACTIVATION_OPERATIONS)
    expect(Contracts.CompleteActivationBody).toBe(CompleteActivationBody)
    expect("ACTIVATION_OPERATIONS" in PublicContracts).toBe(false)
    expect("CompleteActivationData" in PublicContracts).toBe(false)
  })
})

describe("activation request contract", () => {
  it("accepts strict native activation input and normalizes only device name", () => {
    const body = { ...createBody(), device: { ...createBody().device, name: "  Pixel 9  " } }
    expect(CompleteActivationBody.parse(body)).toMatchObject({
      password: PASSWORD,
      device: { name: "Pixel 9" },
    })
  })

  it("validates token and password without printing secret values on failure", () => {
    expectRejectedCases(CompleteActivationBody, [
      ["short activation token", { ...createBody(), token: "a".repeat(42) }],
      ["padded activation token", { ...createBody(), token: `${"a".repeat(42)}=` }],
      ["trimmed password would be too short", { ...createBody(), password: " 123456789 " }],
      ["password contains control", { ...createBody(), password: `abcdefghijk\u0000` }],
      ["unknown root field", { ...createBody(), extra: true }],
    ])
    expect(CompleteActivationBody.parse({ ...createBody(), password: ` ${PASSWORD}` }).password).toBe(
      ` ${PASSWORD}`,
    )

    const syntheticTokenSecret = `!${"t".repeat(42)}`
    const syntheticPasswordSecret = `password\u0000secret`
    const result = CompleteActivationBody.safeParse({
      ...createBody(),
      token: syntheticTokenSecret,
      password: syntheticPasswordSecret,
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      const serializedIssues = JSON.stringify(result.error.issues)
      expect(serializedIssues).not.toContain(syntheticTokenSecret)
      expect(serializedIssues).not.toContain(syntheticPasswordSecret)
    }
  })

  it("validates strict Android device evidence", () => {
    const body = createBody()
    expectRejectedCases(CompleteActivationBody, [
      ["invalid installation UUID", { ...body, device: { ...body.device, installationId: "bad" } }],
      ["blank device name", { ...body, device: { ...body.device, name: " " } }],
      ["oversized device name", { ...body, device: { ...body.device, name: "a".repeat(81) } }],
      ["non-Android platform", { ...body, device: { ...body.device, platform: "ios" } }],
      ["unknown device field", { ...body, device: { ...body.device, extra: true } }],
    ])
  })

  it("accepts only the exact documented app-version language", () => {
    for (const version of ["1.2.3", "1.2.3-beta.1", "1.2.3+build.1"]) {
      expect(AppVersion.parse(version)).toBe(version)
    }
    expectRejectedCases(AppVersion, [
      ["version prefix", "v1.2.3"],
      ["missing patch", "1.2"],
      ["surrounding whitespace", " 1.2.3"],
      ["dual pre-release and build", "1.2.3-beta+build"],
    ])
  })

  it("requires only normalized native compatibility headers", () => {
    const headers = { "x-client-platform": "android", "x-app-version": "1.2.3" }
    expect(CompleteActivationHeaders.parse(headers)).toEqual(headers)
    expectRejectedCases(CompleteActivationHeaders, [
      ["missing platform", { "x-app-version": "1.2.3" }],
      ["wrong platform", { ...headers, "x-client-platform": "web" }],
      ["cookie projection", { ...headers, cookie: "redacted" }],
      ["authorization projection", { ...headers, authorization: "redacted" }],
    ])
  })
})

describe("activation response contract", () => {
  it("accepts only the canonical masked-phone representation", () => {
    expect(PhoneMasked.parse("+91******3210")).toBe("+91******3210")
    expectRejectedCases(PhoneMasked, [
      ["raw E.164 phone", "+919876543210"],
      ["unprefixed phone", "******3210"],
      ["too few mask characters", "+91*****3210"],
      ["control character", "+91******3210\n"],
    ])
  })

  it("parses strict native credentials and canonicalizes expiries", () => {
    const value = { ok: true, data: createData(), error: null, meta: { requestId: UUID, timestamp: "2026-07-20T10:30:00Z" } }
    const parsed = CompleteActivationSuccessEnvelope.parse(value)
    expect(parsed.data.accessTokenExpiresAt).toBe("2026-07-20T10:30:00.000Z")
    expect(parsed.data.refreshTokenExpiresAt).toBe("2026-08-20T10:30:00.000Z")
  })

  it("rejects malformed credentials, inactive users, and leakage fields", () => {
    const data = createData()
    expectRejectedCases(CompleteActivationData, [
      ["short access token", { ...data, accessToken: "a".repeat(99) }],
      ["oversized access token", { ...data, accessToken: "a".repeat(4097) }],
      ["malformed refresh token", { ...data, refreshToken: "a".repeat(42) }],
      ["inactive account", { ...data, user: { ...data.user, accountStatus: "invited" } }],
      ["credential leakage", { ...data, passwordHash: "redacted" }],
      ["device leakage", { ...data, installationId: UUID }],
      ["user privilege leakage", { ...data, user: { ...data.user, roles: ["admin"] } }],
    ])
  })
})

describe("activation JSON Schema", () => {
  it("represents strict request and response boundaries", () => {
    for (const [schema, io] of [
      [CompleteActivationBody, "input"],
      [CompleteActivationHeaders, "input"],
      [CompleteActivationData, "output"],
      [CompleteActivationSuccessEnvelope, "output"],
    ] as const) {
      const serialized = JSON.stringify(z.toJSONSchema(schema, { io }))
      expect(serialized).toContain('"additionalProperties":false')
    }
  })

  it("preserves token, version, Android, active, and token-length constraints", () => {
    const request = JSON.stringify(z.toJSONSchema(CompleteActivationBody, { io: "input" }))
    const response = JSON.stringify(z.toJSONSchema(CompleteActivationData, { io: "output" }))
    expect(request).toContain('"pattern":"^[A-Za-z0-9_-]{43}$"')
    expect(request).toContain('"const":"android"')
    expect(response).toContain('"const":"active"')
    expect(response).toContain('"pattern":"^\\\\+[1-9][0-9]{0,2}[*]{6}[0-9]{4}$"')
    expect(response).toContain('"minLength":100')
    expect(response).toContain('"maxLength":4096')
  })
})
