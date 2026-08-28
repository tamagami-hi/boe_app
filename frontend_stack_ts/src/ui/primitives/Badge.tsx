import type { ReactNode } from "react"

import type { StatusTone } from "~/domain/status"

import styles from "./Surface.module.css"
import { cx } from "~/lib/cx"

export type BadgeProps = Readonly<{
  tone?: StatusTone
  children: ReactNode
}>

export const Badge = ({ tone = "neutral", children }: BadgeProps): React.ReactElement => (
  <span className={cx(styles.badge, styles[tone])}>{children}</span>
)
