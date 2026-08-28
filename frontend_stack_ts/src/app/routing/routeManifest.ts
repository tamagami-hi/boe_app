import type { ComponentType } from "react"

import type { PermissionCode, RoleCode } from "~/domain/permissions"

export type RouteAccess = "public" | "session" | "eligible"

export type BackTarget =
  | Readonly<{ kind: "parent"; path: string }>
  | Readonly<{ kind: "home" }>
  | Readonly<{ kind: "exit" }>

export type NavPlacement = Readonly<{
  domain: string
  order: number
  label: string
  primary?: boolean
}>

export type RouteDef = Readonly<{
  id: string
  path: string
  title: string
  access: RouteAccess
  element: () => Promise<{ default: ComponentType }>
  role?: RoleCode
  permissions?: readonly PermissionCode[]
  requiresAll?: readonly PermissionCode[]
  allowTerminalAccount?: boolean
  nav?: NavPlacement
  back: BackTarget
  transactional?: boolean
  index?: boolean
}>

export type RouteManifest = readonly RouteDef[]

const PARAM_SEGMENT = /^:[A-Za-z0-9_]+$/u

export const isParamSegment = (segment: string): boolean => PARAM_SEGMENT.test(segment)

export const isCatchAll = (path: string): boolean => path === "*"

export const routeSegments = (path: string): readonly string[] =>
  path.split("/").filter((segment) => segment !== "")

export const substituteParams = (
  path: string,
  params: Readonly<Record<string, string | undefined>>,
): string | null => {
  const segments = routeSegments(path)
  const resolved: string[] = []
  for (const segment of segments) {
    if (!isParamSegment(segment)) {
      resolved.push(segment)
      continue
    }
    const value = params[segment.slice(1)]
    if (value === undefined || value === "") return null
    resolved.push(encodeURIComponent(value))
  }
  return `/${resolved.join("/")}`
}

export const matchesRoutePath = (routePath: string, pathname: string): boolean => {
  if (isCatchAll(routePath)) return true
  const routeParts = routeSegments(routePath)
  const pathParts = routeSegments(pathname)
  if (routeParts.length !== pathParts.length) return false
  return routeParts.every((segment, index) => {
    if (isParamSegment(segment)) return pathParts[index] !== undefined
    return segment === pathParts[index]
  })
}

export const matchRouteParams = (
  routePath: string,
  pathname: string,
): Readonly<Record<string, string>> => {
  const routeParts = routeSegments(routePath)
  const pathParts = routeSegments(pathname)
  const params: Record<string, string> = {}
  routeParts.forEach((segment, index) => {
    if (!isParamSegment(segment)) return
    const value = pathParts[index]
    if (value === undefined) return
    params[segment.slice(1)] = decodeURIComponent(value)
  })
  return params
}

export const findRoute = (manifest: RouteManifest, pathname: string): RouteDef | null => {
  const exact = manifest.find(
    (route) => !isCatchAll(route.path) && !route.path.includes(":") && route.path === pathname,
  )
  if (exact !== undefined) return exact

  const parameterised = manifest.find(
    (route) => !isCatchAll(route.path) && matchesRoutePath(route.path, pathname),
  )
  if (parameterised !== undefined) return parameterised

  return manifest.find((route) => isCatchAll(route.path)) ?? null
}

export type NavRoute = RouteDef & Readonly<{ nav: NavPlacement }>

export const navRoutes = (manifest: RouteManifest): readonly NavRoute[] =>
  manifest
    .filter((route): route is NavRoute => route.nav !== undefined)
    .sort((left, right) => left.nav.order - right.nav.order)
