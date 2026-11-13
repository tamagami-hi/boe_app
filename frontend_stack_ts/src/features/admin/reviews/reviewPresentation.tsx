import { Link } from "react-router-dom"

import { useSession } from "~/app/providers/SessionProvider"
import { ADMIN_CELL_LINK } from "~/ui/recipes/admin"

const EXCERPT_LENGTH = 120

export const commentExcerpt = (comment: string | null): string => {
  if (comment === null) return "No comment"
  const flat = comment.replace(/\s+/gu, " ")
  return flat.length <= EXCERPT_LENGTH ? flat : `${flat.slice(0, EXCERPT_LENGTH).trimEnd()}...`
}

export const useCanOpenClient = (): boolean => {
  const { hasAnyPermission } = useSession()
  return hasAnyPermission(["users.read", "users.read_limited"])
}

type ClientLinkProps = Readonly<{ userId: string; name: string; canOpen: boolean }>

export const ClientLink = ({ userId, name, canOpen }: ClientLinkProps): React.ReactElement =>
  canOpen ? (
    <Link to={`/users/${userId}`} className={ADMIN_CELL_LINK}>
      {name}
    </Link>
  ) : (
    <>{name}</>
  )
