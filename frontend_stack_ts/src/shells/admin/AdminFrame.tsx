import { Link, useLocation, useNavigate } from "react-router-dom"
import type { ReactNode } from "react"

import { ADMIN_LOGIN_PATH, ADMIN_ROUTES } from "~/app/routing/adminRoutes"
import { findRoute, navRoutes } from "~/app/routing/routeManifest"
import { useSession } from "~/app/providers/SessionProvider"
import { useAuthPort } from "~/features/auth/authPort"
import { hasAny } from "~/domain/permissions"
import {
  ADMIN_ACTION,
  ADMIN_BODY,
  ADMIN_BOTTOM_NAV,
  ADMIN_CONTENT,
  ADMIN_DOMAIN_LINK,
  ADMIN_DOMAIN_STRIP,
  ADMIN_MESH,
  ADMIN_NAV_ITEM,
  ADMIN_SHELL,
  ADMIN_SIDEBAR,
  ADMIN_SIDEBAR_LINK,
  ADMIN_TITLE,
  ADMIN_TOPBAR,
  ADMIN_WORDMARK,
} from "~/ui/recipes/shellAdmin"

const NAV_ROUTES = navRoutes(ADMIN_ROUTES)
const MOBILE_NAV_LIMIT = 5

export type AdminFrameProps = Readonly<{ children: ReactNode }>

export const AdminFrame = ({ children }: AdminFrameProps): React.ReactElement => {
  const location = useLocation()
  const navigate = useNavigate()
  const session = useSession()
  const port = useAuthPort()

  const route = findRoute(ADMIN_ROUTES, location.pathname)
  const isPublicSurface = route === null || route.access === "public"

  if (isPublicSurface || session.status !== "authenticated") return <>{children}</>

  const permitted = NAV_ROUTES.filter(
    (entry) =>
      entry.permissions === undefined ||
      entry.permissions.length === 0 ||
      hasAny(session.principal?.permissions ?? [], entry.permissions),
  )

  const activeId = route.id
  const activeDomain = route.nav?.domain ?? null
  const siblings =
    activeDomain === null ? [] : permitted.filter((entry) => entry.nav.domain === activeDomain)

  const signOut = (): void => {
    void port.logout().finally(() => {
      session.signedOut()
      void navigate(ADMIN_LOGIN_PATH, { replace: true })
    })
  }

  return (
    <div className={ADMIN_SHELL}>
      <div className={ADMIN_MESH} aria-hidden="true" />
      <div className="be-grain" aria-hidden="true" />
      <div className={ADMIN_BODY}>
        <nav className={ADMIN_SIDEBAR} aria-label="Primary">
          <span className={ADMIN_WORDMARK}>BeOnEdge</span>
          {permitted.map((entry) => (
            <Link
              key={entry.id}
              to={entry.path}
              className={ADMIN_SIDEBAR_LINK}
              aria-current={entry.id === activeId ? "page" : undefined}
            >
              {entry.nav.label}
            </Link>
          ))}
        </nav>

        <div className={ADMIN_CONTENT}>
          <header className={ADMIN_TOPBAR}>
            <span className={ADMIN_TITLE}>{route.title}</span>
            <button type="button" className={ADMIN_ACTION} onClick={signOut}>
              Sign out
            </button>
          </header>

          {siblings.length > 1 ? (
            <nav className={ADMIN_DOMAIN_STRIP} aria-label="Section pages">
              {siblings.map((entry) => (
                <Link
                  key={entry.id}
                  to={entry.path}
                  className={ADMIN_DOMAIN_LINK}
                  aria-current={entry.id === activeId ? "page" : undefined}
                >
                  {entry.nav.label}
                </Link>
              ))}
            </nav>
          ) : null}

          {children}
        </div>
      </div>

      <nav className={ADMIN_BOTTOM_NAV} aria-label="Sections">
        {permitted.slice(0, MOBILE_NAV_LIMIT).map((entry) => (
          <Link
            key={entry.id}
            to={entry.path}
            className={ADMIN_NAV_ITEM}
            aria-current={entry.id === activeId ? "page" : undefined}
          >
            {entry.nav.label}
          </Link>
        ))}
      </nav>
    </div>
  )
}
