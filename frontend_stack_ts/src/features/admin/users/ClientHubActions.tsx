import { Section } from "~/app/layouts/Section"
import { useSession } from "~/app/providers/SessionProvider"
import { ADMIN_ROUTES } from "~/app/routing/adminRoutes"
import { recordLinkQuery } from "~/features/admin/client-values/linkedRecord"
import { Button } from "~/ui/primitives/Button"
import { ButtonLink } from "~/ui/primitives/ButtonLink"
import { Card } from "~/ui/primitives/Card"
import { PROSE_SM } from "~/ui/recipes/datalist"
import { ACTION_ROW } from "~/ui/recipes/layout"

const ACTION_LINKS = [
  {
    routeId: "client-values-individual",
    label: "Update value",
    to: (userId: string) => `/client-values/individual${recordLinkQuery({ userId, fundId: "" })}`,
  },
  { routeId: "email-send", label: "Send an email", to: (userId: string) => `/emails/send?userId=${encodeURIComponent(userId)}` },
  { routeId: "mandates", label: "Mandates", to: () => "/mandates" },
  {
    routeId: "client-values-position",
    label: "Investor record",
    to: (userId: string) => `/client-values/position${recordLinkQuery({ userId, fundId: "" })}`,
  },
  { routeId: "user-erase", label: "Erase client", to: (userId: string) => `/users/${encodeURIComponent(userId)}/erase` },
] as const

type Props = Readonly<{
  userId: string
  canRecord: boolean
  isRecording: boolean
  canClose: boolean
  onToggleRecord: () => void
}>

export const ClientHubActions = ({ userId, canRecord, isRecording, canClose, onToggleRecord }: Props): React.ReactElement => {
  const { hasAnyPermission, hasAllPermissions } = useSession()
  const isOpen = (routeId: string): boolean => {
    const route = ADMIN_ROUTES.find((entry) => entry.id === routeId)
    return route !== undefined && hasAnyPermission(route.permissions ?? []) && hasAllPermissions(route.requiresAll ?? [])
  }
  const links = ACTION_LINKS.filter((link) => isOpen(link.routeId))

  return (
    <Section title="Actions">
      <Card>
        <div className={ACTION_ROW}>
          {canRecord ? (
            <Button
              tone={isRecording ? "secondary" : "primary"}
              size="sm"
              aria-expanded={isRecording}
              disabled={isRecording && !canClose}
              onClick={onToggleRecord}
            >
              {isRecording ? "Close the recording form" : "Record an investment"}
            </Button>
          ) : null}
          {links.map((link) => (
            <ButtonLink key={link.routeId} to={link.to(userId)} tone="secondary" size="sm" trailing>
              {link.label}
            </ButtonLink>
          ))}
        </div>
        <p className={PROSE_SM}>
          {links.length === 0 && !canRecord
            ? "Your account holds no permission that acts on this client."
            : "Update value, Investor record and Send an email open with this client chosen. The mandate screen asks you to pick the client there. Erase client first shows what would block it and what it would remove."}
        </p>
      </Card>
    </Section>
  )
}
