import type { ReactNode } from "react"

import { STATE_DESCRIPTION, STATE_PANEL, STATE_TITLE } from "~/ui/recipes/state"

export type EmptyStateProps = Readonly<{
  title: string
  description?: string
  action?: ReactNode
}>

export const EmptyState = ({
  title,
  description,
  action,
}: EmptyStateProps): React.ReactElement => (
  <div className={STATE_PANEL}>
    <span className={STATE_TITLE}>{title}</span>
    {description === undefined ? null : <p className={STATE_DESCRIPTION}>{description}</p>}
    {action}
  </div>
)
