import { useEffect, useState } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import type { ReactNode } from "react"

import { ADMIN_LOGIN_PATH, ADMIN_NAV_DOMAINS, ADMIN_ROUTES } from "~/app/routing/adminRoutes"
import { findRoute, navBarEntries, navGroups, navRoutes } from "~/app/routing/routeManifest"
import { Modal } from "~/app/overlays/Modal"
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
  ADMIN_MORE_GROUP,
  ADMIN_MORE_GROUP_LABEL,
  ADMIN_MORE_LINK,
  ADMIN_MORE_LIST,
  ADMIN_NAV_ITEM,
  ADMIN_NAV_MORE,
  ADMIN_SHELL,
  ADMIN_SIDEBAR,
  ADMIN_SIDEBAR_LINK,
  ADMIN_TITLE,
  ADMIN_TOPBAR,
  ADMIN_WORDMARK,
} from "~/ui/recipes/shellAdmin"

const NAV_ROUTES = navRoutes(ADMIN_ROUTES)
const MOBILE_NAV_SLOTS = 4

export type AdminFrameProps = Readonly<{ children: ReactNode }>

export const AdminFrame = ({ children }: AdminFrameProps): React.ReactElement => {
  const location = useLocation()
  const navigate = useNavigate()
  const session = useSession()
  const port = useAuthPort()
  const [moreOpen, setMoreOpen] = useState(false)

  useEffect(() => {
    setMoreOpen(false)
  }, [location.pathname])

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

  const navBar = navBarEntries(permitted, MOBILE_NAV_SLOTS)
  const inNavBar = new Set(navBar.map((entry) => entry.id))
  const hasOverflow = permitted.some((entry) => !inNavBar.has(entry.id))
  const groups = navGroups(permitted, ADMIN_NAV_DOMAINS)
  const activeIsOverflow = permitted.some(
    (entry) => entry.id === activeId && !inNavBar.has(entry.id),
  )

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
        {navBar.map((entry) => (
          <Link
            key={entry.id}
            to={entry.path}
            className={ADMIN_NAV_ITEM}
            aria-current={entry.id === activeId ? "page" : undefined}
          >
            {entry.nav.label}
          </Link>
        ))}
        {hasOverflow ? (
          <button
            type="button"
            className={ADMIN_NAV_MORE}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            aria-current={activeIsOverflow ? "page" : undefined}
            onClick={() => {
              setMoreOpen(true)
            }}
          >
            More
          </button>
        ) : null}
      </nav>

      <Modal
        open={moreOpen}
        title="All sections"
        description="Every part of the console your account can open."
        onDismiss={() => {
          setMoreOpen(false)
        }}
      >
        {groups.map((group) => (
          <div key={group.domain} className={ADMIN_MORE_GROUP}>
            {group.entries.length > 1 ? (
              <span className={ADMIN_MORE_GROUP_LABEL}>{group.label}</span>
            ) : null}
            <ul className={ADMIN_MORE_LIST}>
              {group.entries.map((entry) => (
                <li key={entry.id}>
                  <Link
                    to={entry.path}
                    className={ADMIN_MORE_LINK}
                    aria-current={entry.id === activeId ? "page" : undefined}
                  >
                    {entry.nav.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Modal>
    </div>
  )
}
