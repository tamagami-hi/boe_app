import { describe, expect, it } from "vitest"

import { ADMIN_HOME_PATH, ADMIN_ROUTES } from "~/app/routing/adminRoutes"
import { CLIENT_HOME_PATH, CLIENT_ROUTES } from "~/app/routing/clientRoutes"
import { resolveNavOwner } from "~/app/routing/navOwner"
import { findRoute } from "~/app/routing/routeManifest"
import type { RouteDef, RouteManifest } from "~/app/routing/routeManifest"

const ownerOf = (manifest: RouteManifest, homePath: string, pathname: string): string | null => {
  const route = findRoute(manifest, pathname)
  if (route === null) throw new Error(`no route for ${pathname}`)
  return resolveNavOwner(manifest, route, homePath)?.id ?? null
}

const loader = (): Promise<{ default: () => null }> => Promise.resolve({ default: () => null })

const bare = (id: string, path: string, parent: string): RouteDef => ({
  id,
  path,
  title: id,
  access: "session",
  element: loader,
  back: { kind: "parent", path: parent },
})

describe("the admin bottom bar marks the section that owns a child page", () => {
  it.each([
    ["/users/0b0c", "users"],
    ["/users/0b0c/erase", "users"],
    ["/funds/0b0c/aum/history", "funds"],
    ["/aum/collective", "aum"],
    ["/client-values/position", "client-values"],
    ["/emails/templates/new", "email-templates"],
    ["/support/0b0c", "support"],
  ])("%s belongs to %s", (pathname, owner) => {
    expect(ownerOf(ADMIN_ROUTES, ADMIN_HOME_PATH, pathname)).toBe(owner)
  })

  it("keeps a section page as its own owner", () => {
    expect(ownerOf(ADMIN_ROUTES, ADMIN_HOME_PATH, "/users")).toBe("users")
    expect(ownerOf(ADMIN_ROUTES, ADMIN_HOME_PATH, ADMIN_HOME_PATH)).toBe("overview")
  })

  it("does not credit Overview with Account just because Back goes home", () => {
    expect(ownerOf(ADMIN_ROUTES, ADMIN_HOME_PATH, "/account")).toBeNull()
    expect(ownerOf(ADMIN_ROUTES, ADMIN_HOME_PATH, "/account/whats-new")).toBeNull()
  })
})

describe("the client bottom bar marks the tab that owns a child page", () => {
  it.each([
    ["/profile/support", "profile"],
    ["/profile/legal/grievance", "profile"],
    ["/statements", "profile"],
    ["/activity/receipts/0b0c", "activity"],
    ["/sips/0b0c", "portfolio"],
    ["/maturity-options/0b0c", "portfolio"],
    ["/funds/0b0c/invest/sip", "funds"],
  ])("%s belongs to %s", (pathname, owner) => {
    expect(ownerOf(CLIENT_ROUTES, CLIENT_HOME_PATH, pathname)).toBe(owner)
  })

  it("leaves pages reached from the header, and the not-found page, without a tab", () => {
    expect(ownerOf(CLIENT_ROUTES, CLIENT_HOME_PATH, "/notifications")).toBeNull()
    expect(ownerOf(CLIENT_ROUTES, CLIENT_HOME_PATH, "/no-such-page")).toBeNull()
  })
})

describe("a malformed manifest", () => {
  it("stops on a back cycle instead of recursing forever", () => {
    const manifest: RouteManifest = [bare("a", "/a", "/b"), bare("b", "/b", "/a")]
    const [first] = manifest
    if (first === undefined) throw new Error("empty manifest")
    expect(resolveNavOwner(manifest, first, "/home")).toBeNull()
  })
})
