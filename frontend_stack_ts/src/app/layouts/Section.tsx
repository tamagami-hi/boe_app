import type { ReactNode } from "react"

import styles from "./Section.module.css"

export type SectionProps = Readonly<{
  title?: string
  description?: string
  actions?: ReactNode
  children: ReactNode
}>

export const Section = ({
  title,
  description,
  actions,
  children,
}: SectionProps): React.ReactElement => (
  <section className={styles.section}>
    {title === undefined && description === undefined && actions === undefined ? null : (
      <div className={styles.head}>
        <div className={styles.headRow}>
          {title === undefined ? <span /> : <h2 className={styles.title}>{title}</h2>}
          {actions}
        </div>
        {description === undefined ? null : (
          <p className={styles.description}>{description}</p>
        )}
      </div>
    )}
    <div className={styles.body}>{children}</div>
  </section>
)
