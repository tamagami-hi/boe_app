import type { ReactNode } from "react"

import styles from "./ContentGrid.module.css"
import { cx } from "~/lib/cx"

export type ContentGridProps = Readonly<{
  columns?: 2 | 3 | 4
  children: ReactNode
}>

const COLUMN_CLASS = {
  2: "cols2",
  3: "cols3",
  4: "cols4",
} as const

export const ContentGrid = ({
  columns = 3,
  children,
}: ContentGridProps): React.ReactElement => (
  <div className={cx(styles.grid, styles[COLUMN_CLASS[columns]])}>{children}</div>
)
