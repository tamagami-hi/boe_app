import { Suspense, lazy, useMemo } from "react"
import { Navigate, Route, Routes } from "react-router-dom"
import type { ComponentType } from "react"

import { RouteErrorBoundary } from "~/app/routing/RouteErrorBoundary"
import {
  RequireEligible,
  RequirePermission,
  RequireRole,
  RequireSession,
} from "~/app/routing/guards"
import type { EligibilityGate, GuardTargets } from "~/app/routing/guards"
import { isCatchAll } from "~/app/routing/routeManifest"
import type { RouteDef, RouteManifest } from "~/app/routing/routeManifest"
import { Page } from "~/app/layouts/Page"
import { Spinner } from "~/ui/primitives/Feedback"

export type RouterConfig = Readonly<{
  manifest: RouteManifest
  targets: GuardTargets
  indexRedirect: string
  eligibility: EligibilityGate
}>

const RouteFallback = (): React.ReactElement => (
  <Page width="default">
    <Spinner size="md" label="Loading screen" />
  </Page>
)

const lazyElement = (route: RouteDef): ComponentType =>
  lazy(async () => {
    const loaded = await route.element()
    return { default: loaded.default }
  })

const wrapGuards = (
  route: RouteDef,
  config: RouterConfig,
  element: React.ReactElement,
): React.ReactElement => {
  let node = element

  if (route.permissions !== undefined || route.requiresAll !== undefined) {
    node = (
      <RequirePermission
        {...(route.permissions === undefined ? {} : { permissions: route.permissions })}
        {...(route.requiresAll === undefined ? {} : { requiresAll: route.requiresAll })}
      >
        {node}
      </RequirePermission>
    )
  }

  if (route.access === "eligible") {
    node = (
      <RequireEligible targets={config.targets} gate={config.eligibility}>
        {node}
      </RequireEligible>
    )
  }

  if (route.role !== undefined) {
    node = <RequireRole role={route.role}>{node}</RequireRole>
  }

  if (route.access !== "public") {
    node = (
      <RequireSession
        targets={config.targets}
        allowTerminalAccount={route.allowTerminalAccount ?? false}
      >
        {node}
      </RequireSession>
    )
  }

  return node
}

export const buildRouter = (config: RouterConfig): React.ReactElement => {
  const entries = config.manifest.map((route) => {
    const Element = lazyElement(route)
    return {
      route,
      node: wrapGuards(route, config, <Element />),
    }
  })

  return (
    <RouteErrorBoundary>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<Navigate to={config.indexRedirect} replace />} />
          {entries.map(({ route, node }) => (
            <Route
              key={route.id}
              path={isCatchAll(route.path) ? "*" : route.path}
              element={node}
            />
          ))}
        </Routes>
      </Suspense>
    </RouteErrorBoundary>
  )
}

export const useRouter = (config: RouterConfig): React.ReactElement => {
  const { manifest, targets, indexRedirect, eligibility } = config
  return useMemo(
    () => buildRouter({ manifest, targets, indexRedirect, eligibility }),
    [manifest, targets, indexRedirect, eligibility],
  )
}
