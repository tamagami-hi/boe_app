import { randomBytes, randomUUID } from "node:crypto"

import type { FastifyInstance } from "fastify"
import { exportPKCS8, exportSPKI, generateKeyPair } from "jose"

import { createAccessTokenService } from "../../src/auth/accessToken.js"
import { SEED_ROLE_PERMISSIONS } from "../../src/db/seedCatalog.js"
import type { WebAuthDeps } from "../../src/domain/auth/webAuth.js"
import { createLoginEventRepository } from "../../src/repositories/loginEventRepository.js"
import { registerWebAuthRoutes } from "../../src/routes/webAuthRoutes.js"
import { PASSWORD, type PasswordMailStack } from "./passwordMailSupport.js"

export const ADMIN_ORIGIN = "https://admin.beonedge.test"

export interface AdminSession {
  readonly userId: string
  readonly email: string
  readonly cookie: string
  readonly csrf: string
}

export const adminWebAuth = async (stack: PasswordMailStack): Promise<WebAuthDeps> => {
  const keyPair = await generateKeyPair("ES256", { extractable: true })
  return {
    userRepository: stack.userRepository,
    authSessionRepository: stack.authSessionRepository,
    auditRepository: stack.auditRepository,
    accessTokenService: createAccessTokenService({
      issuer: "https://api.beonedge.test",
      audience: "boe-web",
      currentKid: "k1",
      signingKeyPkcs8: await exportPKCS8(keyPair.privateKey),
      verificationKeysSpki: { k1: await exportSPKI(keyPair.publicKey) },
    }),
    database: stack.database,
    refreshKey: randomBytes(32),
    refreshKeyVersion: "rt1",
    csrfKeyVersion: "cs1",
    clock: () => new Date(),
    config: { cookieSecure: false, originAllowlist: [ADMIN_ORIGIN] },
  }
}

export const registerAdminLogin = (instance: FastifyInstance, stack: PasswordMailStack, webAuth: WebAuthDeps): void => {
  registerWebAuthRoutes(instance, { ...webAuth, unitOfWork: stack.unitOfWork, loginEventRepository: createLoginEventRepository() })
}

const cookieHeader = (setCookie: string | string[] | undefined): string => {
  const list = setCookie === undefined ? [] : Array.isArray(setCookie) ? setCookie : [setCookie]
  return list.map((cookie) => cookie.split(";")[0] ?? "").filter((pair) => pair.includes("=")).join("; ")
}

export const signInRoleAdmin = async (app: FastifyInstance, stack: PasswordMailStack, role: string): Promise<AdminSession> => {
  const email = `admin-${randomUUID()}@example.com`
  const userId = (
    await stack.pool.query<{ id: string }>(
      "insert into users (email_normalized, phone_e164, full_name, account_state, activated_at) " +
        "values ($1, $2, 'Admin User', 'active', now()) returning id",
      [email, stack.nextPhone()],
    )
  ).rows[0]?.id
  if (userId === undefined) throw new Error("admin not created")
  await stack.pool.query("insert into user_credentials (user_id, password_hash) values ($1, $2)", [userId, stack.passwordHash])
  for (const permission of SEED_ROLE_PERMISSIONS[role] ?? []) {
    await stack.pool.query(
      "insert into role_permissions (role_id, permission_id, granted_by_user_id) " +
        "select r.id, p.id, $1 from roles r, permissions p where r.code = $3 and p.code = $2 on conflict do nothing",
      [userId, permission, role],
    )
  }
  await stack.pool.query(
    "insert into user_roles (user_id, role_id, granted_by_user_id) select $1, id, $1 from roles where code = $2",
    [userId, role],
  )
  const login = await app.inject({
    method: "POST",
    url: "/v1/auth/web/login",
    headers: { origin: ADMIN_ORIGIN },
    payload: { email, password: PASSWORD },
  })
  if (login.statusCode !== 200) throw new Error(`admin login failed: ${String(login.statusCode)}`)
  const csrf = login.json<{ data: { csrfToken: string } }>().data.csrfToken
  return { userId, email, cookie: cookieHeader(login.headers["set-cookie"]), csrf }
}

export const adminHeaders = (session: AdminSession, key?: string): Record<string, string> => ({
  origin: ADMIN_ORIGIN,
  cookie: session.cookie,
  "x-csrf-token": session.csrf,
  ...(key === undefined ? {} : { "idempotency-key": key }),
})
