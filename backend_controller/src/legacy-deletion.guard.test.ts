import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { describe, expect, test } from "vitest"

/**
 * Guards that legacy JavaScript superseded by the TypeScript rearchitecture stays
 * deleted. Each entry lists the batch that removed it and the TS replacement.
 */
const DELETED_LEGACY_FILES: readonly string[] = [
  // BE-008c: replaced by src/domain/onboarding/{submitApplication,verifyApplicationEmail}.ts
  // + src/routes/publicOnboardingRoutes.ts + the onboarding repositories.
  "website/services/onboardingService.js",
  // BE-009a: replaced by src/auth/passwordHasher.ts (Argon2id).
  "security/passwords.js",
  // BE-009d: HS256 token module replaced by src/auth/accessToken.ts (ES256)
  // + src/auth/sessionTokens.ts (opaque refresh/CSRF).
  "security/tokens.js",
  // BE-010: legacy request-auth + auth service/routes replaced by the canonical
  // native (domain/auth/nativeAuth.ts) and web (domain/auth/webAuth.ts) flows.
  "security/auth.js",
  "shared/services/authService.js",
  "shared/services/authService.signup.test.js",
  "shared/routes/authRoutes.js",
]

describe("legacy deletion guard", () => {
  test.each(DELETED_LEGACY_FILES)("%s remains deleted", (relativePath) => {
    const absolutePath = fileURLToPath(new URL(`./${relativePath}`, import.meta.url))
    expect(existsSync(absolutePath)).toBe(false)
  })
})
