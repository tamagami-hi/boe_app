import type { ButtonHTMLAttributes, ReactNode } from "react"

import styles from "./Surface.module.css"
import { cx } from "~/lib/cx"

export type CardProps = Readonly<{
  elevated?: boolean
  children: ReactNode
}>

export const Card = ({ elevated = false, children }: CardProps): React.ReactElement => (
  <div className={cx(styles.card, elevated && styles.cardElevated)}>
    {children}
  </div>
)

export type InteractiveCardProps = Readonly<{ children: ReactNode }> &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children">

export const InteractiveCard = ({
  children,
  type = "button",
  ...rest
}: InteractiveCardProps): React.ReactElement => (
  <button {...rest} type={type} className={cx(styles.card, styles.cardInteractive)}>
    {children}
  </button>
)
