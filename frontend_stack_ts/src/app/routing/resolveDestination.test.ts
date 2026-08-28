import { describe, expect, it } from "vitest"

import { CLIENT_ROUTES } from "~/app/routing/clientRoutes"
import { resolveDestination } from "~/app/routing/resolveDestination"

const resolve = (value: unknown) => resolveDestination(value, CLIENT_ROUTES)

describe("remote destination refusals", () => {
  it("refuses script and data schemes", () => {
    for (const value of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
    ]) {
      expect(resolve(value), value).toEqual({ kind: "refused", reason: "scheme" })
    }
  })

  it("refuses cleartext http", () => {
    expect(resolve("http://beonedge.in/terms")).toEqual({
      kind: "refused",
      reason: "cleartext",
    })
  })

  it("refuses protocol-relative urls", () => {
    expect(resolve("//evil.example/steal")).toEqual({
      kind: "refused",
      reason: "protocol-relative",
    })
  })

  it("refuses the webview's own origin so remote content cannot re-enter the app shell", () => {
    for (const value of ["https://localhost/app", "https://127.0.0.1/app", "https://[::1]/app"]) {
      expect(resolve(value), value).toEqual({ kind: "refused", reason: "self-origin" })
    }
  })

  it("refuses credentials embedded in the url", () => {
    expect(resolve("https://user:pass@beonedge.in/x")).toEqual({
      kind: "refused",
      reason: "scheme",
    })
  })

  it("refuses an internal path that is not in the manifest", () => {
    expect(resolve("/not-a-real-screen")).toEqual({
      kind: "refused",
      reason: "unknown-route",
    })
  })

  it("refuses non-string and empty input", () => {
    expect(resolve(null)).toEqual({ kind: "refused", reason: "malformed" })
    expect(resolve(42)).toEqual({ kind: "refused", reason: "malformed" })
    expect(resolve("   ")).toEqual({ kind: "refused", reason: "empty" })
  })
})

describe("remote destinations that are allowed", () => {
  it("accepts an internal path present in the manifest", () => {
    expect(resolve("/portfolio")).toEqual({ kind: "internal", path: "/portfolio" })
  })

  it("accepts a parameterised internal path", () => {
    expect(resolve("/funds/abc123")).toEqual({ kind: "internal", path: "/funds/abc123" })
  })

  it("keeps a query string but drops a fragment", () => {
    expect(resolve("/activity?tab=payments#top")).toEqual({
      kind: "internal",
      path: "/activity?tab=payments",
    })
  })

  it("accepts an https external url", () => {
    expect(resolve("https://beonedge.in/terms")).toEqual({
      kind: "external",
      url: "https://beonedge.in/terms",
    })
  })

  it("classifies mailto and tel separately from external", () => {
    expect(resolve("mailto:help@beonedge.in")).toEqual({
      kind: "email",
      address: "help@beonedge.in",
    })
    expect(resolve("tel:+911234567890")).toEqual({ kind: "phone", number: "+911234567890" })
  })
})
