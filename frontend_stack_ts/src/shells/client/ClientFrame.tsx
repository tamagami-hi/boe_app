import { Link, useLocation, useNavigate } from "react-router-dom"
import type { ReactNode } from "react"

import { CLIENT_HOME_PATH, CLIENT_ROUTES } from "~/app/routing/clientRoutes"
import { findRoute, navRoutes } from "~/app/routing/routeManifest"
import { useSession } from "~/app/providers/SessionProvider"
import { useNotifications } from "~/features/shared/queries"
import { BackGlyph, BellGlyph, NAV_GLYPHS } from "~/shells/client/navGlyphs"
import {
  BELL_COUNT,
  BELL_COUNT_NAV,
  BELL_WRAP,
  CLIENT_BELL,
  CLIENT_BOTTOM_NAV,
  CLIENT_CONTENT,
  CLIENT_HEADER,
  CLIENT_ISLAND,
  CLIENT_MESH,
  CLIENT_NAV_GLYPH,
  CLIENT_NAV_ITEM,
  CLIENT_NAV_MARKER,
  CLIENT_SHELL,
  CLIENT_SPACER,
  CLIENT_TOP_NAV,
  CLIENT_TOP_NAV_ITEM,
  CLIENT_TOP_NAV_LIST,
  CLIENT_WORDMARK,
  ICON_ACTION,
  ICON_GLYPH,
} from "~/ui/recipes/shellClient"

const TABS = navRoutes(CLIENT_ROUTES)

export type ClientFrameProps = Readonly<{ children: ReactNode }>

export const ClientFrame = ({ children }: ClientFrameProps): React.ReactElement => {
  const location = useLocation()
  const navigate = useNavigate()
  const session = useSession()

  const route = findRoute(CLIENT_ROUTES, location.pathname)
  const isBareSurface = route === null || route.access === "public" || route.chrome === "none"
  const showsChrome = !isBareSurface && session.status === "authenticated"

  // Hooks cannot sit behind the early return, so the query is told when it is wanted
  // rather than being skipped. Without this it ran on /login, where there is no session:
  // the request 401s, the failure feeds back into a re-render, and the page refetches in a
  // loop tight enough to stop anyone typing their credentials.
  const notifications = useNotifications(showsChrome)

  if (!showsChrome) return <>{children}</>

  const activeId = route.id
  const backPath =
    route.back.kind === "parent"
      ? route.back.path
      : route.back.kind === "home"
        ? CLIENT_HOME_PATH
        : null
  const unreadCount = notifications.data?.unreadCount ?? 0
  const unreadLabel = unreadCount === 0
    ? "Notifications"
    : `Notifications, ${String(unreadCount)} unread`
  const unreadBadge = unreadCount > 99 ? "99+" : String(unreadCount)

  return (
    <div className={CLIENT_SHELL}>
      <div className={CLIENT_MESH} aria-hidden="true" />
      <div className="be-grain" aria-hidden="true" />

      <nav className={CLIENT_TOP_NAV} aria-label="Primary">
        <div className={CLIENT_ISLAND}>
          <span className={CLIENT_WORDMARK}>BeOnEdge</span>
          <ul className={CLIENT_TOP_NAV_LIST}>
            {TABS.map((tab) => (
              <li key={tab.id}>
                <Link
                  to={tab.path}
                  className={CLIENT_TOP_NAV_ITEM}
                  aria-current={tab.id === activeId ? "page" : undefined}
                >
                  {tab.nav.label}
                </Link>
              </li>
            ))}
          </ul>
          <span className={BELL_WRAP}>
            <Link to="/notifications" className={CLIENT_BELL} aria-label={unreadLabel}>
              <BellGlyph className={ICON_GLYPH} />
            </Link>
            {unreadCount === 0 ? null : (
              <span className={BELL_COUNT_NAV} aria-hidden="true">
                {unreadBadge}
              </span>
            )}
          </span>
        </div>
      </nav>

      <header className={CLIENT_HEADER}>
        {backPath === null ? null : (
          <button
            type="button"
            className={ICON_ACTION}
            aria-label="Go back"
            onClick={() => {
              void navigate(backPath)
            }}
          >
            <BackGlyph className={ICON_GLYPH} />
          </button>
        )}
        <span className={CLIENT_SPACER} />
        <span className={BELL_WRAP}>
          <Link to="/notifications" className={ICON_ACTION} aria-label={unreadLabel}>
            <BellGlyph className={ICON_GLYPH} />
          </Link>
          {unreadCount === 0 ? null : (
            <span className={BELL_COUNT} aria-hidden="true">
              {unreadBadge}
            </span>
          )}
        </span>
      </header>

      <div className={CLIENT_CONTENT}>{children}</div>

      <nav className={CLIENT_BOTTOM_NAV} aria-label="Sections">
        {TABS.map((tab) => {
          const Glyph = NAV_GLYPHS[tab.id] ?? NAV_GLYPHS.dashboard
          return (
            <Link
              key={tab.id}
              to={tab.path}
              className={CLIENT_NAV_ITEM}
              aria-current={tab.id === activeId ? "page" : undefined}
            >
              <span className={CLIENT_NAV_MARKER} aria-hidden="true" />
              {Glyph === undefined ? null : <Glyph className={CLIENT_NAV_GLYPH} />}
              {tab.nav.label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
