import { Section } from "~/app/layouts/Section"
import { useSession } from "~/app/providers/SessionProvider"
import { ADMIN_ROUTES } from "~/app/routing/adminRoutes"
import { Button } from "~/ui/primitives/Button"
import { ButtonLink } from "~/ui/primitives/ButtonLink"
import { Card } from "~/ui/primitives/Card"
import { PROSE_SM } from "~/ui/recipes/datalist"
import { ACTION_ROW } from "~/ui/recipes/layout"

const ACTION_LINKS = [
  { routeId: "client-values-individual", label: "Update value", to: () => "/client-values/individual" },
  { routeId: "email-send", label: "Send an email", to: (userId: string) => `/emails/send?userId=${encodeURIComponent(userId)}` },
  { routeId: "mandates", label: "Mandates", to: () => "/mandates" },
  { routeId: "client-values-position", label: "Investor record", to: () => "/client-values/position" },
] as const

type Props = Readonly<{
  userId: string
  canRecord: boolean
  isRecording: boolean
  onToggleRecord: () => void
}>

export const ClientHubActions = ({ userId, canRecord, isRecording, onToggleRecord }: Props): React.ReactElement => {
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
            <Button tone={isRecording ? "secondary" : "primary"} size="sm" aria-expanded={isRecording} onClick={onToggleRecord}>
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
            : "Send an email opens with this client chosen. The value update, investor record and mandate screens ask you to pick the client there."}
        </p>
      </Card>
    </Section>
  )
}
