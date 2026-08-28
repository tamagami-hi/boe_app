import type { ReactNode } from "react"

import styles from "./States.module.css"

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
  <div className={styles.state}>
    <span className={styles.title}>{title}</span>
    {description === undefined ? null : <p className={styles.description}>{description}</p>}
    {action}
  </div>
)
