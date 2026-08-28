import { describe, expect, it } from "vitest"

import { ADMIN_GUARD_DESTINATIONS, ADMIN_LINK_MAP, ADMIN_ROUTES } from "~/app/routing/adminRoutes"
import {
  CLIENT_GUARD_DESTINATIONS,
  CLIENT_LINK_MAP,
  CLIENT_ROUTES,
} from "~/app/routing/clientRoutes"
import { findRoute, isCatchAll, navRoutes, substituteParams } from "~/app/routing/routeManifest"
import type { RouteManifest } from "~/app/routing/routeManifest"

const MANIFESTS = [
  ["client", CLIENT_ROUTES, CLIENT_LINK_MAP, CLIENT_GUARD_DESTINATIONS] as const,
  ["admin", ADMIN_ROUTES, ADMIN_LINK_MAP, ADMIN_GUARD_DESTINATIONS] as const,
]

const paramSample = (path: string): string =>
  path
    .split("/")
    .map((segment) => (segment.startsWith(":") ? "sample-id" : segment))
    .join("/")

describe.each(MANIFESTS)("%s route manifest integrity", (_name, manifest, linkMap, guardDestinations) => {
  const routes: RouteManifest = manifest
  const ids = new Set(routes.map((route) => route.id))

  it("has unique ids and unique paths", () => {
    expect(ids.size).toBe(routes.length)
    const paths = routes.map((route) => route.path)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it("declares exactly one catch-all route", () => {
    expect(routes.filter((route) => isCatchAll(route.path))).toHaveLength(1)
  })

  it("resolves every declared path back to its own route", () => {
    for (const route of routes) {
      if (isCatchAll(route.path)) continue
      const resolved = findRoute(routes, paramSample(route.path))
      expect(resolved?.id, route.path).toBe(route.id)
    }
  })

  it("declares a back target on every route, and parent targets are real routes", () => {
    for (const route of routes) {
      expect(route.back, route.id).toBeDefined()
      if (route.back.kind !== "parent") continue
      const parent = findRoute(routes, paramSample(route.back.path))
      expect(parent, `${route.id} parent ${route.back.path}`).not.toBeNull()
      expect(isCatchAll(parent?.path ?? "*"), `${route.id} parent is catch-all`).toBe(false)
    }
  })

  it("can substitute every parent path's parameters from its child", () => {
    for (const route of routes) {
      if (route.back.kind !== "parent") continue
      const childParams = Object.fromEntries(
        route.path
          .split("/")
          .filter((segment) => segment.startsWith(":"))
          .map((segment) => [segment.slice(1), "sample-id"]),
      )
      expect(substituteParams(route.back.path, childParams), route.id).not.toBeNull()
    }
  })

  it("points every nav entry at a mounted route", () => {
    for (const entry of navRoutes(routes)) {
      expect(ids.has(entry.id), entry.id).toBe(true)
    }
  })

  it("only links to route ids that exist", () => {
    for (const [source, targets] of Object.entries(linkMap)) {
      expect(ids.has(source), `link source ${source}`).toBe(true)
      for (const target of targets) {
        expect(ids.has(target), `${source} -> ${target}`).toBe(true)
      }
    }
  })

  it("gives every non-public route a way in, by nav entry, inbound link, or guard redirect", () => {
    const linked = new Set(Object.values(linkMap).flat())
    const navIds = new Set(navRoutes(routes).map((entry) => entry.id))
    const guards = new Set(guardDestinations)

    for (const route of routes) {
      if (route.access === "public") continue
      const reachable = navIds.has(route.id) || linked.has(route.id) || guards.has(route.id)
      expect(reachable, `${route.id} is unreachable from every declared surface`).toBe(true)
    }
  })

  it("only names real routes as guard destinations", () => {
    for (const id of guardDestinations) {
      expect(ids.has(id), `guard destination ${id}`).toBe(true)
    }
  })
})

describe("client route map fixes the legacy reachability hole", () => {
  it("gives SIP detail a list parent rather than only programmatic entry", () => {
    const detail = CLIENT_ROUTES.find((route) => route.id === "sip-detail")
    expect(detail?.back).toEqual({ kind: "parent", path: "/sips" })
    expect(CLIENT_LINK_MAP.sips).toContain("sip-detail")
  })

  it("reaches the regulatory screens from Legal", () => {
    expect(CLIENT_LINK_MAP["profile-legal"]).toEqual(
      expect.arrayContaining(["investor-charter", "grievance"]),
    )
  })

  it("marks the money-moving screens transactional so Back can confirm", () => {
    const transactional = CLIENT_ROUTES.filter((route) => route.transactional === true).map(
      (route) => route.id,
    )
    expect(transactional).toEqual(
      expect.arrayContaining(["invest-lumpsum", "invest-sip", "payment-status"]),
    )
  })
})
