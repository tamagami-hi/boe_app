import type { ReactNode } from "react"

import { STATE_DESCRIPTION, STATE_PANEL, STATE_TITLE } from "~/ui/recipes/state"

export type EmptyStateProps = Readonly<{
  title?: string | undefined
  description?: string | undefined
  action?: ReactNode | undefined
}>

export const EmptyState = ({
  title,
  description,
  action,
}: EmptyStateProps): React.ReactElement => (
  <div className={STATE_PANEL}>
    {title === undefined ? null : <span className={STATE_TITLE}>{title}</span>}
    {description === undefined ? null : <p className={STATE_DESCRIPTION}>{description}</p>}
    {action}
  </div>
)
