import { describe, expect, it } from "vitest"

import { ADMIN_NAV_DOMAINS, ADMIN_ROUTES } from "~/app/routing/adminRoutes"
import { navGroups, navRoutes } from "~/app/routing/routeManifest"
import type { NavGroup, NavRoute } from "~/app/routing/routeManifest"
import { ADMIN_SIDEBAR_DOMAIN_ORDER, orderSidebarGroups } from "~/shells/admin/adminSidebarOrder"

const ALL_PAGES = navRoutes(ADMIN_ROUTES)

const sidebarFor = (pages: readonly NavRoute[]): readonly NavGroup[] =>
  orderSidebarGroups(navGroups(pages, ADMIN_NAV_DOMAINS), ADMIN_SIDEBAR_DOMAIN_ORDER)

const labelsOf = (groups: readonly NavGroup[]): readonly string[] => groups.map((group) => group.label)

const pageIdsOf = (groups: readonly NavGroup[]): readonly string[] =>
  groups.flatMap((group) => group.entries.map((entry) => entry.id)).sort()

describe("the admin desktop sidebar order", () => {
  it("puts the single-page sections first, then the grouped ones, and keeps every page", () => {
    const groups = sidebarFor(ALL_PAGES)

    expect(labelsOf(groups)).toEqual([
      "Overview",
      "Applications",
      "Funds",
      "AUM",
      "Users",
      "Client values",
      "Support",
      "Money",
      "System",
    ])
    expect(pageIdsOf(groups)).toEqual(ALL_PAGES.map((entry) => entry.id).sort())
  })

  it("keeps that order for an admin who can open only some sections", () => {
    const visible = new Set(["system", "aum", "users", "overview"])
    const groups = sidebarFor(ALL_PAGES.filter((entry) => visible.has(entry.nav.domain)))

    expect(labelsOf(groups)).toEqual(["Overview", "AUM", "Users", "System"])
  })

  it("keeps a section the order does not name, after the named ones", () => {
    const [first] = ALL_PAGES
    if (first === undefined) throw new Error("The admin manifest has no navigable page.")
    const stray: NavRoute = { ...first, id: "stray-page", nav: { ...first.nav, domain: "stray", order: 0 } }
    const groups = orderSidebarGroups(
      [{ domain: "stray", label: "Stray", entries: [stray] }, ...navGroups(ALL_PAGES, ADMIN_NAV_DOMAINS)],
      ADMIN_SIDEBAR_DOMAIN_ORDER,
    )

    expect(labelsOf(groups).at(-1)).toBe("Stray")
    expect(pageIdsOf(groups)).toContain("stray-page")
    expect(groups).toHaveLength(ADMIN_SIDEBAR_DOMAIN_ORDER.length + 1)
  })
})
