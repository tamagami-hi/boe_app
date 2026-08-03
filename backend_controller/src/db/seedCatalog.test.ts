import { createHash } from "node:crypto"

import { describe, expect, test } from "vitest"

import {
  buildSeedStatements,
  consentDigest,
  SEED_CONSENT_DOCUMENTS,
  SEED_PERMISSIONS,
  SEED_ROLE_PERMISSIONS,
  SEED_ROLES,
} from "./seedCatalog.js"
import { SEED_CONTENT_DOCUMENTS } from "./seedContent.js"

const ROLE_CODE = /^[a-z][a-z0-9_]*$/u
const PERMISSION_CODE = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/u

describe("bootstrap catalog", () => {
  test("seeds the five canonical roles with snake_case codes", () => {
    expect(SEED_ROLES.map((role) => role.code)).toEqual([
      "superadmin",
      "onboarding",
      "finance",
      "content",
      "support",
    ])
    for (const role of SEED_ROLES) {
      expect(role.code).toMatch(ROLE_CODE)
      expect(role.name.trim()).not.toBe("")
    }
  })

  test("permission codes are unique single-dot domain.action labels", () => {
    const codes = SEED_PERMISSIONS.map((permission) => permission.code)
    expect(new Set(codes).size).toBe(codes.length)
    for (const permission of SEED_PERMISSIONS) {
      expect(permission.code).toMatch(PERMISSION_CODE)
      expect(permission.description.trim()).not.toBe("")
    }
  })

  test("every role-permission mapping references a known role and permission", () => {
    const roleCodes = new Set(SEED_ROLES.map((role) => role.code))
    const permissionCodes = new Set(SEED_PERMISSIONS.map((permission) => permission.code))
    for (const [roleCode, granted] of Object.entries(SEED_ROLE_PERMISSIONS)) {
      expect(roleCodes.has(roleCode)).toBe(true)
      for (const code of granted) {
        expect(permissionCodes.has(code)).toBe(true)
      }
    }
  })

  test("superadmin holds every permission", () => {
    expect([...(SEED_ROLE_PERMISSIONS.superadmin ?? [])].sort()).toEqual(
      SEED_PERMISSIONS.map((permission) => permission.code).sort(),
    )
  })

  test("consent digest matches SHA-256 of the markdown bytes", () => {
    const terms = SEED_CONSENT_DOCUMENTS[0]
    expect(terms).toBeDefined()
    const markdown = terms?.contentMarkdown ?? ""
    const digest = consentDigest(markdown)
    expect(digest).toHaveLength(32)
    expect(digest.equals(createHash("sha256").update(markdown, "utf8").digest())).toBe(true)
  })

  test("publishes the documents the app reads, with a payload the client can render", () => {
    // The client used to hard-code this copy; it is content now so wording and
    // contacts can change without a release.
    const keys = SEED_CONTENT_DOCUMENTS.map((document) => document.contentKey)
    expect(keys).toContain("disclosures")
    expect(keys).toContain("investor-charter")
    expect(keys).toContain("grievance-redressal")
    expect(keys).toContain("research-context")
    expect(SEED_CONTENT_DOCUMENTS.filter((document) => document.kind === "faq").length).toBeGreaterThan(3)
    expect(new Set(keys).size).toBe(keys.length)

    // This model has no units and no per-unit price, so the copy must not promise
    // either — that wording is what the retired NAV model used.
    const copy = JSON.stringify(SEED_CONTENT_DOCUMENTS).toLowerCase()
    expect(copy).not.toContain("nav")
    expect(copy).not.toContain("units allocate")
    expect(copy).not.toContain("per unit")
  })

  test("builds one idempotent statement per catalog row", () => {
    const statements = buildSeedStatements()
    expect(statements).toHaveLength(
      SEED_ROLES.length +
        SEED_PERMISSIONS.length +
        SEED_CONSENT_DOCUMENTS.length +
        SEED_CONTENT_DOCUMENTS.length,
    )
    for (const statement of statements) {
      expect(statement.text).toContain("ON CONFLICT")
    }
    const consentStatements = statements.slice(
      SEED_ROLES.length + SEED_PERMISSIONS.length,
      SEED_ROLES.length + SEED_PERMISSIONS.length + SEED_CONSENT_DOCUMENTS.length,
    )
    for (const statement of consentStatements) {
      const digestValue = statement.values[4]
      expect(Buffer.isBuffer(digestValue)).toBe(true)
      expect(digestValue as Buffer).toHaveLength(32)
    }
  })
})
