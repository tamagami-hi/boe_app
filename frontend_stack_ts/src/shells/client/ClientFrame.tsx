import { Link, useLocation, useNavigate } from "react-router-dom"
import type { ReactNode } from "react"

import { CLIENT_HOME_PATH, CLIENT_ROUTES } from "~/app/routing/clientRoutes"
import { findRoute, navRoutes } from "~/app/routing/routeManifest"
import { useSession } from "~/app/providers/SessionProvider"
import { cx } from "~/lib/cx"
import { BackGlyph, BellGlyph, NAV_GLYPHS } from "~/shells/client/navGlyphs"

import styles from "./ClientFrame.module.css"

const TABS = navRoutes(CLIENT_ROUTES)

export type ClientFrameProps = Readonly<{ children: ReactNode }>

export const ClientFrame = ({ children }: ClientFrameProps): React.ReactElement => {
  const location = useLocation()
  const navigate = useNavigate()
  const session = useSession()

  const route = findRoute(CLIENT_ROUTES, location.pathname)
  const isPublicSurface = route === null || route.access === "public"

  if (isPublicSurface || session.status !== "authenticated") return <>{children}</>

  const activeId = route.id
  const backTarget = route.back.kind === "parent" ? route.back.path : null

  return (
    <div className={styles.shell}>
      <div className="be-grain" />

      <nav className={styles.topNav} aria-label="Primary">
        <div className={styles.island}>
          <span className={styles.wordmark}>BeOnEdge</span>
          <ul className={styles.topNavList}>
            {TABS.map((tab) => (
              <li key={tab.id}>
                <Link
                  to={tab.path}
                  className={cx(styles.topNavItem, tab.id === activeId && styles.topNavItemActive)}
                  aria-current={tab.id === activeId ? "page" : undefined}
                >
                  {tab.nav.label}
                </Link>
              </li>
            ))}
          </ul>
          <Link to="/notifications" className={styles.bell} aria-label="Notifications">
            <BellGlyph className={styles.glyph} />
          </Link>
        </div>
      </nav>

      <header className={styles.header}>
        {backTarget === null ? null : (
          <button
            type="button"
            className={styles.iconAction}
            aria-label="Go back"
            onClick={() => {
              void navigate(-1)
            }}
          >
            <BackGlyph className={styles.glyph} />
          </button>
        )}
        <span className={styles.title}>{route.title}</span>
        <Link to="/notifications" className={styles.iconAction} aria-label="Notifications">
          <BellGlyph className={styles.glyph} />
        </Link>
      </header>

      <div className={styles.content}>{children}</div>

      <nav className={styles.bottomNav} aria-label="Primary">
        {TABS.map((tab) => {
          const Glyph = NAV_GLYPHS[tab.id] ?? NAV_GLYPHS.dashboard
          return (
            <Link
              key={tab.id}
              to={tab.path}
              className={cx(styles.navItem, tab.id === activeId && styles.navItemActive)}
              aria-current={tab.id === activeId ? "page" : undefined}
            >
              <span className={styles.navMarker} aria-hidden="true" />
              {Glyph === undefined ? null : <Glyph className={styles.navGlyph} />}
              {tab.nav.label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}

export const CLIENT_TAB_IDS: readonly string[] = TABS.map((tab) => tab.id)
export const CLIENT_DEFAULT_PATH = CLIENT_HOME_PATH
