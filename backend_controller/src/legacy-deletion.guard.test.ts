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
]

describe("legacy deletion guard", () => {
  test.each(DELETED_LEGACY_FILES)("%s remains deleted", (relativePath) => {
    const absolutePath = fileURLToPath(new URL(`./${relativePath}`, import.meta.url))
    expect(existsSync(absolutePath)).toBe(false)
  })
})
