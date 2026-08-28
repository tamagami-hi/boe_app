import type { ButtonHTMLAttributes, ReactNode } from "react"

import { cx } from "~/lib/cx"

import styles from "./Button.module.css"

export type ButtonTone = "primary" | "gold" | "secondary" | "ghost" | "danger"
export type ButtonSize = "sm" | "md" | "lg"

export type ButtonProps = Readonly<{
  tone?: ButtonTone
  size?: ButtonSize
  loading?: boolean
  fullWidth?: boolean
  trailing?: boolean
  children: ReactNode
}> &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children">

const TrailingGlyph = (): React.ReactElement => (
  <span className={styles.trail} aria-hidden="true">
    <svg
      className={styles.trailGlyph}
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 11 11 3" />
      <path d="M4.6 3H11v6.4" />
    </svg>
  </span>
)

export const Button = ({
  tone = "primary",
  size = "md",
  loading = false,
  fullWidth = false,
  trailing = false,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps): React.ReactElement => (
  <button
    {...rest}
    type={type}
    className={cx(styles.button, styles[tone], styles[size], fullWidth && styles.fullWidth)}
    disabled={disabled === true || loading}
    aria-busy={loading}
  >
    {loading ? <span className={styles.spinner} /> : null}
    {children}
    {trailing && !loading ? <TrailingGlyph /> : null}
  </button>
)
