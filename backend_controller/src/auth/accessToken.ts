/**
 * ES256 access-token service (spec 04 §4.1). Access JWTs use `jose` with ES256
 * only: the current signing key is a PKCS#8 private PEM addressed by a versioned
 * protected-header `kid`; every current/retired verification key is an SPKI
 * public PEM. Signing uses only the configured current `kid`. Verification
 * rejects a missing/unknown `kid`, selects that public key, and pins issuer,
 * audience, ES256, `typ=access`, and at most 30 seconds of clock skew. Claims are
 * iss, aud, sub, sid, jti, iat, nbf, exp, typ. Refresh tokens are never JWTs and
 * are handled elsewhere (BE-009d).
 */
import { randomUUID } from "node:crypto"

import { decodeProtectedHeader, importPKCS8, importSPKI, jwtVerify, SignJWT } from "jose"
import type { CryptoKey } from "jose"

import { AppError } from "../http/errorCatalog.js"

const ALGORITHM = "ES256"
const TOKEN_TYPE = "access"
const DEFAULT_TTL_SECONDS = 600
const DEFAULT_CLOCK_SKEW_SECONDS = 30

export interface AccessTokenConfig {
  readonly issuer: string
  readonly audience: string
  readonly currentKid: string
  readonly signingKeyPkcs8: string
  /** kid -> SPKI public PEM, including retired keys still within TTL + skew. */
  readonly verificationKeysSpki: Readonly<Record<string, string>>
  readonly ttlSeconds?: number
  readonly clockSkewSeconds?: number
}

export interface AccessTokenClaims {
  readonly sub: string
  readonly sid: string
}

export interface VerifiedAccessToken {
  readonly sub: string
  readonly sid: string
  readonly jti: string
  readonly kid: string
}

export interface AccessTokenService {
  sign: (claims: AccessTokenClaims) => Promise<string>
  verify: (token: string) => Promise<VerifiedAccessToken>
}

export const createAccessTokenService = (config: AccessTokenConfig): AccessTokenService => {
  const ttlSeconds = config.ttlSeconds ?? DEFAULT_TTL_SECONDS
  const clockSkewSeconds = config.clockSkewSeconds ?? DEFAULT_CLOCK_SKEW_SECONDS

  let signingKey: Promise<CryptoKey> | undefined
  const getSigningKey = (): Promise<CryptoKey> =>
    (signingKey ??= importPKCS8(config.signingKeyPkcs8, ALGORITHM))

  const verificationKeyCache = new Map<string, Promise<CryptoKey>>()
  const getVerificationKey = (kid: string): Promise<CryptoKey> | null => {
    const pem = config.verificationKeysSpki[kid]
    if (pem === undefined) return null
    let key = verificationKeyCache.get(kid)
    if (key === undefined) {
      key = importSPKI(pem, ALGORITHM)
      verificationKeyCache.set(kid, key)
    }
    return key
  }

  return {
    sign: async (claims) => {
      const now = Math.floor(Date.now() / 1000)
      return new SignJWT({ sid: claims.sid })
        .setProtectedHeader({ alg: ALGORITHM, kid: config.currentKid, typ: TOKEN_TYPE })
        .setIssuer(config.issuer)
        .setAudience(config.audience)
        .setSubject(claims.sub)
        .setJti(randomUUID())
        .setIssuedAt(now)
        .setNotBefore(now)
        .setExpirationTime(now + ttlSeconds)
        .sign(await getSigningKey())
    },

    verify: async (token) => {
      let kid: unknown
      try {
        kid = decodeProtectedHeader(token).kid
      } catch {
        throw new AppError("AUTHENTICATION_REQUIRED")
      }
      if (typeof kid !== "string") throw new AppError("AUTHENTICATION_REQUIRED")

      const keyPromise = getVerificationKey(kid)
      if (keyPromise === null) throw new AppError("AUTHENTICATION_REQUIRED")

      try {
        const { payload } = await jwtVerify(token, await keyPromise, {
          issuer: config.issuer,
          audience: config.audience,
          algorithms: [ALGORITHM],
          typ: TOKEN_TYPE,
          clockTolerance: clockSkewSeconds,
        })
        const sid = payload.sid
        if (typeof payload.sub !== "string" || typeof sid !== "string" || typeof payload.jti !== "string") {
          throw new AppError("AUTHENTICATION_REQUIRED")
        }
        return { sub: payload.sub, sid, jti: payload.jti, kid }
      } catch (error: unknown) {
        if (error instanceof AppError) throw error
        throw new AppError("AUTHENTICATION_REQUIRED")
      }
    },
  }
}
