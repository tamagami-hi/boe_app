import { Link } from "react-router-dom"

import type { NavGroup, NavRoute } from "~/app/routing/routeManifest"
import { cx } from "~/lib/cx"
import { useAdminSidebarShown } from "~/shells/admin/adminSidebarPreference"
import {
  ADMIN_SIDEBAR,
  ADMIN_SIDEBAR_GROUP,
  ADMIN_SIDEBAR_GROUP_LABEL,
  ADMIN_SIDEBAR_HEAD,
  ADMIN_SIDEBAR_HEAD_HIDDEN,
  ADMIN_SIDEBAR_HEAD_SHOWN,
  ADMIN_SIDEBAR_HIDDEN,
  ADMIN_SIDEBAR_LINK,
  ADMIN_SIDEBAR_LIST,
  ADMIN_SIDEBAR_NAV,
  ADMIN_SIDEBAR_SHOWN,
  ADMIN_SIDEBAR_SINGLE,
  ADMIN_SIDEBAR_TOGGLE,
  ADMIN_SIDEBAR_TOGGLE_GLYPH,
  ADMIN_SIDEBAR_TOGGLE_GLYPH_HIDDEN,
  ADMIN_SIDEBAR_TOGGLE_LABEL_HIDDEN,
  ADMIN_WORDMARK,
} from "~/ui/recipes/shellAdmin"

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

export type AdminSidebarProps = Readonly<{
  groups: readonly NavGroup[]
  ownerId: string | null
  idPrefix: string
}>

export const AdminSidebar = ({ groups, ownerId, idPrefix }: AdminSidebarProps): React.ReactElement => {
  const [isShown, toggle] = useAdminSidebarShown()
  const navId = `${idPrefix}-nav`
  const toggleLabel = isShown ? "Hide menu" : "Show menu"

  return (
    <div className={cx(ADMIN_SIDEBAR, isShown ? ADMIN_SIDEBAR_SHOWN : ADMIN_SIDEBAR_HIDDEN)}>
      <div className={cx(ADMIN_SIDEBAR_HEAD, isShown ? ADMIN_SIDEBAR_HEAD_SHOWN : ADMIN_SIDEBAR_HEAD_HIDDEN)}>
        {isShown ? <span className={ADMIN_WORDMARK}>BeOnEdge</span> : null}
        <button
          type="button"
          className={ADMIN_SIDEBAR_TOGGLE}
          aria-expanded={isShown}
          aria-controls={navId}
          title={isShown ? undefined : toggleLabel}
          onClick={toggle}
        >
          <svg
            className={cx(ADMIN_SIDEBAR_TOGGLE_GLYPH, isShown ? undefined : ADMIN_SIDEBAR_TOGGLE_GLYPH_HIDDEN)}
            viewBox="0 0 18 18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M11 4.5 6.5 9l4.5 4.5" />
          </svg>
          <span className={isShown ? undefined : ADMIN_SIDEBAR_TOGGLE_LABEL_HIDDEN}>{toggleLabel}</span>
        </button>
      </div>
      <nav id={navId} className={ADMIN_SIDEBAR_NAV} aria-label="Primary" hidden={!isShown}>
        {groups.map((group) => (
          <AdminSidebarGroup key={group.domain} group={group} ownerId={ownerId} idPrefix={idPrefix} />
        ))}
      </nav>
    </div>
  )
}
