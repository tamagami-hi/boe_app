import type { ReactNode } from "react"

import { Reveal } from "~/ui/motion/Reveal"

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
  <Reveal>
    <header className={styles.header}>
      {eyebrow === undefined ? null : <span className={styles.eyebrow}>{eyebrow}</span>}
      <div className={styles.row}>
        <h1 className={styles.title}>{title}</h1>
        {actions === undefined ? null : <div className={styles.actions}>{actions}</div>}
      </div>
      <span className={styles.rule} />
      {description === undefined ? null : <p className={styles.description}>{description}</p>}
    </header>
  </Reveal>
)
