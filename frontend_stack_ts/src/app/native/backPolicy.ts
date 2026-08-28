import { findRoute, matchRouteParams, substituteParams } from "~/app/routing/routeManifest"
import type { RouteManifest } from "~/app/routing/routeManifest"

export type BackPolicyInput = Readonly<{ pathname: string }>

export type BackPolicy = Readonly<{
  isTransactional: boolean
  parentPath: string | null
  isPrimary: boolean
  isHome: boolean
  isPublic: boolean
  homePath: string
}>

export type BackPolicyResolver = (input: BackPolicyInput) => BackPolicy

export const BACK_RESULT = Object.freeze({
  HANDLED: "handled",
  PASS: "pass",
  EXIT: "exit",
} as const)

export type BackResult = (typeof BACK_RESULT)[keyof typeof BACK_RESULT]

export const createBackPolicyResolver = (
  manifest: RouteManifest,
  homePath: string,
): BackPolicyResolver => ({ pathname }) => {
  const route = findRoute(manifest, pathname)

  if (route === null) {
    return {
      isTransactional: false,
      parentPath: null,
      isPrimary: false,
      isHome: pathname === homePath,
      isPublic: false,
      homePath,
    }
  }

  const params = matchRouteParams(route.path, pathname)

  const parentPath =
    route.back.kind === "parent" ? substituteParams(route.back.path, params) : null

  return {
    isTransactional: route.transactional === true,
    parentPath,
    isPrimary: route.nav?.primary === true,
    isHome: route.back.kind === "exit" && route.nav?.primary === true,
    isPublic: route.access === "public",
    homePath,
  }
}
