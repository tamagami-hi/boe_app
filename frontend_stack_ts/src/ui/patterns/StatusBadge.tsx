import type { StatusPresentation } from "~/domain/status"
import { Badge } from "~/ui/primitives/Badge"

export type StatusBadgeProps = Readonly<{
  status: StatusPresentation
}>

export const StatusBadge = ({ status }: StatusBadgeProps): React.ReactElement => (
  <Badge tone={status.tone}>{status.label}</Badge>
)
