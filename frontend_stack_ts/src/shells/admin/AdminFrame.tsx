import { useEffect, useId, useState } from "react"
import { Link, useLocation } from "react-router-dom"
import type { ReactNode } from "react"

import { ADMIN_ACCOUNT_PATH, ADMIN_HOME_PATH, ADMIN_NAV_DOMAINS, ADMIN_ROUTES } from "~/app/routing/adminRoutes"
import { resolveNavOwner } from "~/app/routing/navOwner"
import { findRoute, navBarEntries, navGroups, navRoutes } from "~/app/routing/routeManifest"
import type { NavGroup, NavRoute } from "~/app/routing/routeManifest"
import { Modal } from "~/app/overlays/Modal"
import { useSession } from "~/app/providers/SessionProvider"
import { MaturityDuePrompt } from "~/features/admin/maturities/MaturityDuePrompt"
import { SurvivingHeldWriteScope, useHasUnsettledHeldWrite } from "~/features/admin/shared/unsettledHeldWrites"
import { ADMIN_NOTES } from "~/features/whats-new/adminNotes"
import { WhatsNewPrompt } from "~/features/whats-new/WhatsNewPrompt"
import { hasAll, hasAny } from "~/domain/permissions"
import {
  ADMIN_ACTION_LINK,
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
  ADMIN_SIDEBAR_GROUP,
  ADMIN_SIDEBAR_GROUP_LABEL,
  ADMIN_SIDEBAR_LINK,
  ADMIN_SIDEBAR_LIST,
  ADMIN_SIDEBAR_SINGLE,
  ADMIN_TITLE,
  ADMIN_TOPBAR,
  ADMIN_WORDMARK,
} from "~/ui/recipes/shellAdmin"

const NAV_ROUTES = navRoutes(ADMIN_ROUTES)
const MOBILE_NAV_SLOTS = 4

export type AdminFrameProps = Readonly<{ children: ReactNode }>

type AdminSidebarGroupProps = Readonly<{ group: NavGroup; ownerId: string | null; idPrefix: string }>

const AdminSidebarGroup = ({ group, ownerId, idPrefix }: AdminSidebarGroupProps): React.ReactElement => {
  const sidebarLink = (entry: NavRoute): React.ReactElement => (
    <Link
      to={entry.path}
      className={ADMIN_SIDEBAR_LINK}
      aria-current={entry.id === ownerId ? "page" : undefined}
    >
      {entry.nav.label}
    </Link>
  )
  const [only] = group.entries
  if (group.entries.length === 1 && only !== undefined) {
    return <div className={ADMIN_SIDEBAR_SINGLE}>{sidebarLink(only)}</div>
  }
  const headingId = `${idPrefix}-${group.domain}`
  return (
    <div className={ADMIN_SIDEBAR_GROUP}>
      <span id={headingId} className={ADMIN_SIDEBAR_GROUP_LABEL}>
        {group.label}
      </span>
      <ul aria-labelledby={headingId} className={ADMIN_SIDEBAR_LIST}>
        {group.entries.map((entry) => (
          <li key={entry.id}>{sidebarLink(entry)}</li>
        ))}
      </ul>
    </div>
  )
}

export const AdminFrame = ({ children }: AdminFrameProps): React.ReactElement => {
  const location = useLocation()
  const session = useSession()
  const sidebarId = useId()
  const isHoldingWrite = useHasUnsettledHeldWrite()
  const [moreOpen, setMoreOpen] = useState(false)
  const [maturityPromptDismissedFor, setMaturityPromptDismissedFor] = useState<string | null>(null)

  useEffect(() => {
    setMoreOpen(false)
  }, [location.pathname])

  const route = findRoute(ADMIN_ROUTES, location.pathname)
  const isPublicSurface = route === null || route.access === "public"

  if (isPublicSurface || session.status !== "authenticated") return <>{children}</>

  const granted = session.principal?.permissions ?? []
  const permitted = NAV_ROUTES.filter(
    (entry) => hasAny(granted, entry.permissions ?? []) && hasAll(granted, entry.requiresAll ?? []),
  )

  const activeId = route.id
  const ownerId = resolveNavOwner(ADMIN_ROUTES, route, ADMIN_HOME_PATH)?.id ?? null
  const isAccountSection =
    route.path === ADMIN_ACCOUNT_PATH || (route.back.kind === "parent" && route.back.path === ADMIN_ACCOUNT_PATH)
  const activeDomain = route.nav?.domain ?? null
  const siblings =
    activeDomain === null ? [] : permitted.filter((entry) => entry.nav.domain === activeDomain)

  const navBar = navBarEntries(permitted, MOBILE_NAV_SLOTS)
  const inNavBar = new Set(navBar.map((entry) => entry.id))
  const hasOverflow = permitted.some((entry) => !inNavBar.has(entry.id))
  const groups = navGroups(permitted, ADMIN_NAV_DOMAINS)
  const ownerIsOverflow = permitted.some(
    (entry) => entry.id === ownerId && !inNavBar.has(entry.id),
  )

  return (
    <div className={ADMIN_SHELL}>
      <div className={ADMIN_MESH} aria-hidden="true" />
      <div className="be-grain" aria-hidden="true" />
      <div className={ADMIN_BODY}>
        <nav className={ADMIN_SIDEBAR} aria-label="Primary">
          <span className={ADMIN_WORDMARK}>BeOnEdge</span>
          {groups.map((group) => (
            <AdminSidebarGroup key={group.domain} group={group} ownerId={ownerId} idPrefix={sidebarId} />
          ))}
        </nav>

        <div className={ADMIN_CONTENT}>
          <header className={ADMIN_TOPBAR}>
            <span className={ADMIN_TITLE}>{route.title}</span>
            <Link
              to={ADMIN_ACCOUNT_PATH}
              className={ADMIN_ACTION_LINK}
              aria-current={isAccountSection ? "page" : undefined}
            >
              Account
            </Link>
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
            aria-current={entry.id === ownerId ? "page" : undefined}
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
            aria-current={ownerIsOverflow ? "page" : undefined}
            onClick={() => {
              setMoreOpen(true)
            }}
          >
            More
          </button>
        ) : null}
      </nav>

      <SurvivingHeldWriteScope value>
        <MaturityDuePrompt
          dismissed={maturityPromptDismissedFor !== null && maturityPromptDismissedFor === session.principal?.userId}
          onDismiss={() => {
            setMaturityPromptDismissedFor(session.principal?.userId ?? null)
          }}
        />
      </SurvivingHeldWriteScope>

      <WhatsNewPrompt notes={ADMIN_NOTES} isHeldBack={isHoldingWrite} />

      <Modal
        open={moreOpen}
        title="All sections"
        description="Every part of the console your account can open."
        onDismiss={() => {
          setMoreOpen(false)
        }}
      >
        {groups.map((group) => {
          const moreLabelId = group.entries.length > 1 ? `${sidebarId}-more-${group.domain}` : undefined
          return (
            <div key={group.domain} className={ADMIN_MORE_GROUP}>
              {moreLabelId === undefined ? null : (
                <span id={moreLabelId} className={ADMIN_MORE_GROUP_LABEL}>
                  {group.label}
                </span>
              )}
              <ul aria-labelledby={moreLabelId} className={ADMIN_MORE_LIST}>
                {group.entries.map((entry) => (
                  <li key={entry.id}>
                    <Link
                      to={entry.path}
                      className={ADMIN_MORE_LINK}
                      aria-current={entry.id === ownerId ? "page" : undefined}
                    >
                      {entry.nav.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </Modal>
    </div>
  )
}
