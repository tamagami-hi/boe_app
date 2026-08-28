import type { ReactNode } from "react"

import styles from "./AuthLayout.module.css"

export type AuthLayoutProps = Readonly<{
  tagline?: string
  children: ReactNode
}>

export const AuthLayout = ({ tagline, children }: AuthLayoutProps): React.ReactElement => (
  <div className={styles.shell}>
    <div className={styles.panel}>
      <div className={styles.brand}>
        <span className={styles.wordmark}>BeOnEdge</span>
        {tagline === undefined ? null : <span className={styles.tagline}>{tagline}</span>}
      </div>
      <div className={styles.body}>{children}</div>
    </div>
  </div>
)
