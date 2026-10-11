import { describe, expect, test } from "vitest"

import { AppError } from "../../http/errorCatalog.js"
import {
  buildPasswordLink,
  requirePasswordLinkBase,
  resolvePasswordLinkBase,
  type PasswordLinkProblem,
  type PasswordLinkSettings,
} from "./passwordLinkUrl.js"

const PAGE = "https://app.beonedge.example/reset-password"

const problemOf = (settings: PasswordLinkSettings): PasswordLinkProblem | null => {
  const resolved = resolvePasswordLinkBase(settings)
  return resolved.kind === "unusable" ? resolved.problem : null
}

describe("resolvePasswordLinkBase", () => {
  test("accepts an absolute https page address and returns it unchanged", () => {
    expect(resolvePasswordLinkBase({ clientUrl: PAGE, requireHttps: true })).toEqual({ kind: "ready", base: PAGE })
  })

  test("accepts cleartext http only where https is not required", () => {
    const local = "http://localhost:5174/reset-password"

    expect(resolvePasswordLinkBase({ clientUrl: local, requireHttps: false })).toEqual({ kind: "ready", base: local })
    expect(problemOf({ clientUrl: local, requireHttps: true })).toBe("insecure")
  })

  test.each<[string, string | null, PasswordLinkProblem]>([
    ["is not set", null, "missing"],
    ["is empty", "", "missing"],
    ["is relative", "/reset-password", "malformed"],
    ["has no scheme", "app.beonedge.example/reset-password", "malformed"],
    ["is not a web scheme", "javascript:alert(1)", "malformed"],
    ["is a file address", "file:///etc/passwd", "malformed"],
    ["contains whitespace", "https://app.beonedge.example/reset password", "malformed"],
    ["carries a username", "https://admin@app.beonedge.example/reset-password", "credentials"],
    ["carries a username and password", "https://admin:secret@app.beonedge.example/reset-password", "credentials"],
    ["carries a query", `${PAGE}?campaign=1`, "query_or_fragment"],
    ["ends with an empty query", `${PAGE}?`, "query_or_fragment"],
    ["carries a fragment", `${PAGE}#top`, "query_or_fragment"],
    ["ends with an empty fragment", `${PAGE}#`, "query_or_fragment"],
  ])("refuses an address that %s", (_name, clientUrl, expected) => {
    expect(problemOf({ clientUrl, requireHttps: true })).toBe(expected)
  })
})

const failureOf = (settings: PasswordLinkSettings): unknown => {
  try {
    requirePasswordLinkBase(settings)
    return null
  } catch (error) {
    return error
  }
}

describe("requirePasswordLinkBase", () => {
  test("answers unavailable, names the setting and says nothing was saved when the address is unusable", () => {
    const missing = failureOf({ clientUrl: null, requireHttps: true })

    expect(missing).toBeInstanceOf(AppError)
    expect(missing).toMatchObject({ code: "DEPENDENCY_UNAVAILABLE", httpStatus: 503 })
    expect((missing as AppError).message).toContain("CLIENT_PASSWORD_LINK_URL is not set")
    expect((missing as AppError).message).toContain("Nothing was saved")
    expect((failureOf({ clientUrl: "http://app.beonedge.example/x", requireHttps: true }) as AppError).message).toContain(
      "must use https in production",
    )
  })

  test("returns the usable base", () => {
    expect(requirePasswordLinkBase({ clientUrl: PAGE, requireHttps: true })).toBe(PAGE)
  })
})

describe("buildPasswordLink", () => {
  test("adds the token as the only query parameter and encodes it", () => {
    const link = new URL(buildPasswordLink(PAGE, "a+b/c d=&?#"))

    expect(`${link.origin}${link.pathname}`).toBe(PAGE)
    expect([...link.searchParams.keys()]).toEqual(["token"])
    expect(link.searchParams.get("token")).toBe("a+b/c d=&?#")
    expect(link.hash).toBe("")
  })
})
