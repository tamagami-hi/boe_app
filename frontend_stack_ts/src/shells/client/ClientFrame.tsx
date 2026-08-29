import { Link, useLocation, useNavigate } from "react-router-dom"
import type { ReactNode } from "react"

import { CLIENT_HOME_PATH, CLIENT_ROUTES } from "~/app/routing/clientRoutes"
import { findRoute, navRoutes } from "~/app/routing/routeManifest"
import { useSession } from "~/app/providers/SessionProvider"
import { BackGlyph, BellGlyph, NAV_GLYPHS } from "~/shells/client/navGlyphs"
import {
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
  CLIENT_TITLE,
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
  const isPublicSurface = route === null || route.access === "public"

  if (isPublicSurface || session.status !== "authenticated") return <>{children}</>

  const activeId = route.id
  const backTarget = route.back.kind === "parent" ? route.back.path : null

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
          <Link to="/notifications" className={CLIENT_BELL} aria-label="Notifications">
            <BellGlyph className={ICON_GLYPH} />
          </Link>
        </div>
      </nav>

      <header className={CLIENT_HEADER}>
        {backTarget === null ? null : (
          <button
            type="button"
            className={ICON_ACTION}
            aria-label="Go back"
            onClick={() => {
              void navigate(-1)
            }}
          >
            <BackGlyph className={ICON_GLYPH} />
          </button>
        )}
        <span className={CLIENT_TITLE}>{route.title}</span>
        <Link to="/notifications" className={ICON_ACTION} aria-label="Notifications">
          <BellGlyph className={ICON_GLYPH} />
        </Link>
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

export const CLIENT_TAB_IDS: readonly string[] = TABS.map((tab) => tab.id)
export const CLIENT_DEFAULT_PATH = CLIENT_HOME_PATH
