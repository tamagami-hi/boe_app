import type { ReactNode } from "react"

import { cx } from "~/lib/cx"
import {
  ALERT_BASE,
  ALERT_TITLE,
  DIVIDER,
  SKELETON,
  SKELETON_CIRCLE,
  SPINNER_BASE,
  SPINNER_SIZE,
  TONE_CLASS,
} from "~/ui/recipes/surface"

export const Divider = (): React.ReactElement => <hr className={DIVIDER} />

export type SpinnerProps = Readonly<{ size?: "sm" | "md"; label?: string }>

export const Spinner = ({ size = "sm", label = "Loading" }: SpinnerProps): React.ReactElement => (
  <span
    className={cx(SPINNER_BASE, SPINNER_SIZE[size])}
    role="progressbar"
    aria-label={label}
  />
)

export type SkeletonProps = Readonly<{
  width?: string
  height?: string
  circle?: boolean
}>

export const Skeleton = ({
  width = "100%",
  height = "1rem",
  circle = false,
}: SkeletonProps): React.ReactElement => (
  <span
    className={cx(SKELETON, circle ? SKELETON_CIRCLE : undefined)}
    style={{ width, height }}
    aria-hidden="true"
  />
)

export type AlertTone = "info" | "warning" | "error" | "success"

export type AlertProps = Readonly<{
  tone?: AlertTone
  title?: string
  children: ReactNode
}>

const ALERT_TONE = {
  info: TONE_CLASS.info,
  warning: TONE_CLASS.warning,
  error: TONE_CLASS.negative,
  success: TONE_CLASS.positive,
} as const

export const Alert = ({ tone = "info", title, children }: AlertProps): React.ReactElement => (
  <div className={cx(ALERT_BASE, ALERT_TONE[tone])} role={tone === "error" ? "alert" : "status"}>
    {title === undefined ? null : <span className={ALERT_TITLE}>{title}</span>}
    <span>{children}</span>
  </div>
)
