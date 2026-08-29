import type { ReactNode } from "react"

import { cx } from "~/lib/cx"
import { PAGE_BASE, PAGE_WIDTH } from "~/ui/recipes/layout"
import type { PageWidth } from "~/ui/recipes/layout"

export type { PageWidth }

export type PageProps = Readonly<{
  width?: PageWidth
  children: ReactNode
}>

export const Page = ({ width = "default", children }: PageProps): React.ReactElement => (
  <main className={cx(PAGE_BASE, PAGE_WIDTH[width])}>{children}</main>
)
