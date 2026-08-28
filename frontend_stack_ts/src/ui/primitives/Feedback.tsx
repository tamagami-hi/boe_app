import type { ReactNode } from "react"

import styles from "./Surface.module.css"
import { cx } from "~/lib/cx"

export const Divider = (): React.ReactElement => <hr className={styles.divider} />

export type SpinnerProps = Readonly<{ size?: "sm" | "md"; label?: string }>

export const Spinner = ({ size = "sm", label = "Loading" }: SpinnerProps): React.ReactElement => (
  <span
    className={cx(styles.spinner, size === "sm" ? styles.spinnerSm : styles.spinnerMd)}
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
    className={cx(styles.skeleton, circle && styles.skeletonCircle)}
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

const ALERT_TONE_CLASS = {
  info: "info",
  warning: "warning",
  error: "negative",
  success: "positive",
} as const

export const Alert = ({ tone = "info", title, children }: AlertProps): React.ReactElement => (
  <div
    className={cx(styles.alert, styles[ALERT_TONE_CLASS[tone]])}
    role={tone === "error" ? "alert" : "status"}
  >
    {title === undefined ? null : <span className={styles.alertTitle}>{title}</span>}
    <span>{children}</span>
  </div>
)
