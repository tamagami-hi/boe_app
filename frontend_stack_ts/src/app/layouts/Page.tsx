import type { ReactNode } from "react"

import styles from "./Page.module.css"
import { cx } from "~/lib/cx"

export type PageWidth = "default" | "wide" | "form"

export type PageProps = Readonly<{
  width?: PageWidth
  children: ReactNode
}>

export const Page = ({ width = "default", children }: PageProps): React.ReactElement => (
  <main className={cx(styles.page, styles[width])}>{children}</main>
)
