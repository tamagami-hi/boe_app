import { Link, useLocation, useNavigate } from "react-router-dom"
import type { ReactNode } from "react"

import { ADMIN_LOGIN_PATH, ADMIN_ROUTES } from "~/app/routing/adminRoutes"
import { findRoute, navRoutes } from "~/app/routing/routeManifest"
import { useSession } from "~/app/providers/SessionProvider"
import { useAuthPort } from "~/features/auth/authPort"
import { hasAny } from "~/domain/permissions"
import { cx } from "~/lib/cx"

import styles from "./AdminFrame.module.css"

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
    activeDomain === null
      ? []
      : permitted.filter((entry) => entry.nav.domain === activeDomain)

  const signOut = (): void => {
    void port.logout().finally(() => {
      session.signedOut()
      void navigate(ADMIN_LOGIN_PATH, { replace: true })
    })
  }

  return (
    <div className={styles.shell}>
      <div className={styles.body}>
        <nav className={styles.sidebar} aria-label="Sections">
          <span className={styles.wordmark}>BeOnEdge</span>
          {permitted.map((entry) => (
            <Link
              key={entry.id}
              to={entry.path}
              className={cx(styles.sidebarLink, entry.id === activeId && styles.sidebarLinkActive)}
              aria-current={entry.id === activeId ? "page" : undefined}
            >
              {entry.nav.label}
            </Link>
          ))}
        </nav>

        <div className={styles.content}>
          <header className={styles.topbar}>
            <span className={styles.title}>{route.title}</span>
            <button type="button" className={styles.action} onClick={signOut}>
              Sign out
            </button>
          </header>

          {siblings.length > 1 ? (
            <nav className={styles.domainStrip} aria-label="Section pages">
              {siblings.map((entry) => (
                <Link
                  key={entry.id}
                  to={entry.path}
                  className={cx(styles.domainLink, entry.id === activeId && styles.domainLinkActive)}
                >
                  {entry.nav.label}
                </Link>
              ))}
            </nav>
          ) : null}

          {children}
        </div>
      </div>

      <nav className={styles.bottomNav} aria-label="Sections">
        {permitted.slice(0, MOBILE_NAV_LIMIT).map((entry) => (
          <Link
            key={entry.id}
            to={entry.path}
            className={cx(styles.navItem, entry.id === activeId && styles.navItemActive)}
            aria-current={entry.id === activeId ? "page" : undefined}
          >
            {entry.nav.label}
          </Link>
        ))}
      </nav>
    </div>
  )
}
