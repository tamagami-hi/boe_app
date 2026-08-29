import type { ReactNode } from "react"

import { Reveal } from "~/ui/motion/Reveal"

import { EYEBROW } from "~/ui/recipes/surface"
import {
  PAGE_HEADER_ACTIONS,
  PAGE_HEADER_DESC,
  PAGE_HEADER_ROOT,
  PAGE_HEADER_ROW,
  PAGE_HEADER_RULE,
  PAGE_HEADER_TITLE,
} from "~/ui/recipes/layout"

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
    <header className={PAGE_HEADER_ROOT}>
      {eyebrow === undefined ? null : <span className={EYEBROW}>{eyebrow}</span>}
      <div className={PAGE_HEADER_ROW}>
        <h1 className={PAGE_HEADER_TITLE}>{title}</h1>
        {actions === undefined ? null : <div className={PAGE_HEADER_ACTIONS}>{actions}</div>}
      </div>
      <span className={PAGE_HEADER_RULE} />
      {description === undefined ? null : <p className={PAGE_HEADER_DESC}>{description}</p>}
    </header>
  </Reveal>
)
