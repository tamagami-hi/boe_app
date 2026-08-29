import type { ReactNode } from "react"

import { cx } from "~/lib/cx"
import { GRID_BASE, GRID_COLS } from "~/ui/recipes/layout"

export type ContentGridProps = Readonly<{
  columns?: 2 | 3 | 4
  children: ReactNode
}>

export const ContentGrid = ({
  columns = 3,
  children,
}: ContentGridProps): React.ReactElement => (
  <div className={cx(GRID_BASE, GRID_COLS[columns])}>{children}</div>
)
