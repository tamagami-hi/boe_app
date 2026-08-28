import type { ButtonHTMLAttributes, ReactNode } from "react"

import styles from "./Button.module.css"

export type ButtonTone = "primary" | "secondary" | "ghost" | "danger"
export type ButtonSize = "sm" | "md" | "lg"

export type ButtonProps = Readonly<{
  tone?: ButtonTone
  size?: ButtonSize
  loading?: boolean
  fullWidth?: boolean
  children: ReactNode
}> &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children">

export const Button = ({
  tone = "primary",
  size = "md",
  loading = false,
  fullWidth = false,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps): React.ReactElement => {
  const classes = [styles.button, styles[tone], styles[size]]
  if (fullWidth) classes.push(styles.fullWidth)

  return (
    <button
      {...rest}
      type={type}
      className={classes.join(" ")}
      disabled={disabled === true || loading}
      aria-busy={loading}
    >
      {loading ? <span className={styles.spinner} /> : null}
      {children}
    </button>
  )
}
