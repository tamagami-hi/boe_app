import type { ReactNode } from "react"

import {
  SECTION_BODY,
  SECTION_HEAD,
  SECTION_HEAD_DESC,
  SECTION_HEAD_ROW,
  SECTION_HEAD_TITLE,
  SECTION_ROOT,
} from "~/ui/recipes/layout"

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
  <section className={SECTION_ROOT}>
    {title === undefined && description === undefined && actions === undefined ? null : (
      <div className={SECTION_HEAD}>
        <div className={SECTION_HEAD_ROW}>
          {title === undefined ? <span /> : <h2 className={SECTION_HEAD_TITLE}>{title}</h2>}
          {actions}
        </div>
        {description === undefined ? null : (
          <p className={SECTION_HEAD_DESC}>{description}</p>
        )}
      </div>
    )}
    <div className={SECTION_BODY}>{children}</div>
  </section>
)
