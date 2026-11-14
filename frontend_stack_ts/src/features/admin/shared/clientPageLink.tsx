import type { ReactNode } from "react"
import { Link } from "react-router-dom"

import { ADMIN_CELL_LINK } from "~/ui/recipes/admin"

import { useRouteAccess } from "./routeAccess"

const CLIENT_PAGE_ROUTE_ID = "user-detail"

export const clientPagePath = (userId: string): string => `/users/${encodeURIComponent(userId)}`

export const useCanOpenClientPage = (): boolean => useRouteAccess()(CLIENT_PAGE_ROUTE_ID)

export type ClientPageLinkProps = Readonly<{
  userId: string | null | undefined
  children: ReactNode
  onOpen?: () => void
}>

export const ClientPageLink = ({ userId, children, onOpen }: ClientPageLinkProps): React.ReactElement => {
  const canOpen = useCanOpenClientPage()
  if (!canOpen || userId === null || userId === undefined || userId === "") return <>{children}</>
  return (
    <Link to={clientPagePath(userId)} className={ADMIN_CELL_LINK} onClick={onOpen}>
      {children}
    </Link>
  )
}
