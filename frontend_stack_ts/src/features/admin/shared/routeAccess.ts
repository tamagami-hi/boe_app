import { useSession } from "~/app/providers/SessionProvider"
import { ADMIN_ROUTES } from "~/app/routing/adminRoutes"

export type RouteAccess = (routeId: string) => boolean

export const useRouteAccess = (): RouteAccess => {
  const { hasAnyPermission, hasAllPermissions } = useSession()
  return (routeId) => {
    const route = ADMIN_ROUTES.find((entry) => entry.id === routeId)
    return route !== undefined && hasAnyPermission(route.permissions ?? []) && hasAllPermissions(route.requiresAll ?? [])
  }
}
