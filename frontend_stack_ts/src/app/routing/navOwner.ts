import type { NavRoute, RouteDef, RouteManifest } from "~/app/routing/routeManifest"

const isNavRoute = (route: RouteDef): route is NavRoute => route.nav !== undefined

const ownerAt = (
  manifest: RouteManifest,
  route: RouteDef,
  homePath: string,
  depth: number,
): NavRoute | null => {
  if (isNavRoute(route)) return route
  if (route.back.kind !== "parent" || depth >= manifest.length) return null
  const parentPath = route.back.path
  if (parentPath === homePath) return null
  const parent = manifest.find((candidate) => candidate.path === parentPath)
  return parent === undefined ? null : ownerAt(manifest, parent, homePath, depth + 1)
}

export const resolveNavOwner = (
  manifest: RouteManifest,
  route: RouteDef,
  homePath: string,
): NavRoute | null => ownerAt(manifest, route, homePath, 0)
