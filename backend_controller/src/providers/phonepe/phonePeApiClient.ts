import {
  GatewayMalformedResponseError,
  GatewayUnavailableError,
} from "./paymentGateway.js"

export type PhonePeHttpClient = (url: string, init: RequestInit) => Promise<Response>

export interface PhonePeApiConfig {
  readonly clientId: string
  readonly clientSecret: string
  readonly clientVersion: string
  readonly env: "sandbox" | "production"
  readonly requestTimeoutMs: number
}

interface AccessGrant {
  readonly authorization: string
  readonly expiresAtSeconds: number
}

export interface PhonePeApiClient {
  readonly authorizedRequest: (path: string, init: RequestInit) => Promise<Response>
}

const endpoint = (env: PhonePeApiConfig["env"], path: string): string =>
  env === "sandbox"
    ? `https://api-preprod.phonepe.com/apis/pg-sandbox${path}`
    : `https://api.phonepe.com/apis/pg${path}`

const oauthEndpoint = (env: PhonePeApiConfig["env"]): string =>
  env === "sandbox"
    ? "https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token"
    : "https://api.phonepe.com/apis/identity-manager/v1/oauth/token"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export const createPhonePeApiClient = (
  deps: Readonly<{ config: PhonePeApiConfig; httpClient?: PhonePeHttpClient; clock?: () => Date }>,
): PhonePeApiClient => {
  const httpClient = deps.httpClient ?? fetch
  const clock = deps.clock ?? (() => new Date())
  let cachedGrant: AccessGrant | null = null
  let grantRequest: Promise<AccessGrant> | null = null

  const request = async (url: string, init: RequestInit): Promise<Response> => {
    try {
      return await httpClient(url, { ...init, signal: AbortSignal.timeout(deps.config.requestTimeoutMs) })
    } catch (error) {
      throw new GatewayUnavailableError("the provider call failed; retry later", { cause: error })
    }
  }

  const fetchGrant = async (): Promise<AccessGrant> => {
    const form = new URLSearchParams()
    form.set("client_id", deps.config.clientId)
    form.set("client_version", deps.config.clientVersion)
    form.set("client_secret", deps.config.clientSecret)
    form.set("grant_type", "client_credentials")
    const response = await request(oauthEndpoint(deps.config.env), {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    })
    if (!response.ok) throw new GatewayUnavailableError("the provider call failed; retry later", { cause: { httpStatusCode: response.status } })
    let body: unknown
    try {
      body = await response.json()
    } catch {
      body = null
    }
    if (!isRecord(body)) throw new GatewayMalformedResponseError("the provider returned an invalid OAuth response")
    const accessToken = typeof body.access_token === "string" && body.access_token.trim() !== ""
      ? body.access_token
      : null
    const expiresAtSeconds = body.expires_at
    const nowSeconds = Math.floor(clock().getTime() / 1000)
    if (
      accessToken === null || body.token_type !== "O-Bearer" ||
      typeof expiresAtSeconds !== "number" || !Number.isSafeInteger(expiresAtSeconds) ||
      expiresAtSeconds - 60 <= nowSeconds
    ) throw new GatewayMalformedResponseError("the provider returned an invalid OAuth response")
    return { authorization: `O-Bearer ${accessToken}`, expiresAtSeconds }
  }

  const grant = async (forceRefresh = false): Promise<AccessGrant> => {
    const nowSeconds = Math.floor(clock().getTime() / 1000)
    if (!forceRefresh && cachedGrant !== null && cachedGrant.expiresAtSeconds - 60 > nowSeconds) return cachedGrant
    if (grantRequest !== null) return grantRequest
    const pending = fetchGrant().then((value) => {
      cachedGrant = value
      return value
    })
    grantRequest = pending
    try {
      return await pending
    } finally {
      if (grantRequest === pending) grantRequest = null
    }
  }

  const authorizedRequest = async (path: string, init: RequestInit): Promise<Response> => {
    let access = await grant()
    let response = await request(endpoint(deps.config.env, path), {
      ...init,
      headers: { ...init.headers, Authorization: access.authorization },
    })
    if (response.status !== 401) return response
    cachedGrant = null
    access = await grant(true)
    response = await request(endpoint(deps.config.env, path), {
      ...init,
      headers: { ...init.headers, Authorization: access.authorization },
    })
    return response
  }

  return Object.freeze({ authorizedRequest })
}
