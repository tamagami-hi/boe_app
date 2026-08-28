import type { ReactNode } from "react"

import styles from "./PageHeader.module.css"

export type PageHeaderProps = Readonly<{
  title: string
  eyebrow?: string
  description?: string
  actions?: ReactNode
}>

export const PageHeader = ({
  title,
  eyebrow,
  description,
  actions,
}: PageHeaderProps): React.ReactElement => (
  <header className={styles.header}>
    {eyebrow === undefined ? null : <p className={styles.eyebrow}>{eyebrow}</p>}
    <div className={styles.row}>
      <h1 className={styles.title}>{title}</h1>
      {actions === undefined ? null : <div className={styles.actions}>{actions}</div>}
    </div>
    {description === undefined ? null : <p className={styles.description}>{description}</p>}
  </header>
)
