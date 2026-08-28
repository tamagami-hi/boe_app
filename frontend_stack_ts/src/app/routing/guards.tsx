import { Navigate, useLocation } from "react-router-dom"
import type { ReactNode } from "react"

import { useSession } from "~/app/providers/SessionProvider"
import type { PermissionCode, RoleCode } from "~/domain/permissions"
import { ErrorState } from "~/ui/patterns/ErrorState"
import { Page } from "~/app/layouts/Page"
import { Spinner } from "~/ui/primitives/Feedback"

export type GuardTargets = Readonly<{
  loginPath: string
  blockedPath: string | null
  verifyEmailPath: string | null
}>

export type EligibilityGate = Readonly<{
  loading: boolean
  canInvest: boolean
}>

const RestoringScreen = (): React.ReactElement => (
  <Page width="form">
    <Spinner size="md" label="Restoring your session" />
  </Page>
)

const ForbiddenScreen = (): React.ReactElement => (
  <Page width="default">
    <ErrorState variant="forbidden" />
  </Page>
)

export type RequireSessionProps = Readonly<{
  targets: GuardTargets
  allowTerminalAccount?: boolean
  children: ReactNode
}>

export const RequireSession = ({
  targets,
  allowTerminalAccount = false,
  children,
}: RequireSessionProps): React.ReactElement => {
  const { status, principal } = useSession()
  const location = useLocation()

  if (status === "restoring") return <RestoringScreen />

  if (status === "anonymous" || principal === null) {
    const from = `${location.pathname}${location.search}`
    return <Navigate to={`${targets.loginPath}?from=${encodeURIComponent(from)}`} replace />
  }

  const terminal = principal.accountState === "suspended" || principal.accountState === "closed"
  if (terminal && !allowTerminalAccount && targets.blockedPath !== null) {
    return <Navigate to={targets.blockedPath} replace />
  }

  return <>{children}</>
}

export type RequireRoleProps = Readonly<{
  role: RoleCode
  children: ReactNode
}>

export const RequireRole = ({ role, children }: RequireRoleProps): React.ReactElement => {
  const { hasRole } = useSession()
  if (!hasRole(role)) return <ForbiddenScreen />
  return <>{children}</>
}

export type RequirePermissionProps = Readonly<{
  permissions?: readonly PermissionCode[]
  requiresAll?: readonly PermissionCode[]
  children: ReactNode
}>

export const RequirePermission = ({
  permissions,
  requiresAll,
  children,
}: RequirePermissionProps): React.ReactElement => {
  const { hasAnyPermission, hasAllPermissions } = useSession()

  if (permissions !== undefined && permissions.length > 0 && !hasAnyPermission(permissions)) {
    return <ForbiddenScreen />
  }
  if (requiresAll !== undefined && requiresAll.length > 0 && !hasAllPermissions(requiresAll)) {
    return <ForbiddenScreen />
  }
  return <>{children}</>
}

export type RequireEligibleProps = Readonly<{
  targets: GuardTargets
  gate: EligibilityGate
  children: ReactNode
}>

export const RequireEligible = ({
  targets,
  gate,
  children,
}: RequireEligibleProps): React.ReactElement => {
  const location = useLocation()

  if (gate.loading) return <RestoringScreen />

  if (!gate.canInvest && targets.verifyEmailPath !== null) {
    const returnTo = `${location.pathname}${location.search}`
    return (
      <Navigate
        to={`${targets.verifyEmailPath}?returnTo=${encodeURIComponent(returnTo)}`}
        replace
      />
    )
  }

  return <>{children}</>
}
