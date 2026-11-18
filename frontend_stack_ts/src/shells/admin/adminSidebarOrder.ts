import type { NavGroup } from "~/app/routing/routeManifest"

export const ADMIN_SIDEBAR_DOMAIN_ORDER: readonly string[] = [
  "overview",
  "applications",
  "funds",
  "aum",
  "users",
  "client-values",
  "support",
  "money",
  "system",
]

export const orderSidebarGroups = (
  groups: readonly NavGroup[],
  domainOrder: readonly string[],
): readonly NavGroup[] => {
  const rank = (domain: string): number => {
    const index = domainOrder.indexOf(domain)
    return index === -1 ? domainOrder.length : index
  }
  return [...groups].sort((left, right) => rank(left.domain) - rank(right.domain))
}
