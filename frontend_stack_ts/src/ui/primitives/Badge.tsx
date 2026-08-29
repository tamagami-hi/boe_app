import type { ReactNode } from "react"

import { cx } from "~/lib/cx"
import type { StatusTone } from "~/domain/status"
import { BADGE_BASE, TONE_CLASS } from "~/ui/recipes/surface"

export type BadgeProps = Readonly<{
  tone?: StatusTone
  children: ReactNode
}>

export const Badge = ({ tone = "neutral", children }: BadgeProps): React.ReactElement => (
  <span className={cx(BADGE_BASE, TONE_CLASS[tone])}>{children}</span>
)
