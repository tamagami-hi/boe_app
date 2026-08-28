import { describe, expect, test } from "vitest"

import { shouldRevokeUserSessions } from "./adminOversightRoutes.js"

describe("admin user lifecycle session revocation", () => {
  test("revokes sessions for suspension and closure but not reinstatement", () => {
    expect(shouldRevokeUserSessions("suspended")).toBe(true)
    expect(shouldRevokeUserSessions("closed")).toBe(true)
    expect(shouldRevokeUserSessions("active")).toBe(false)
  })
})
