import type { ButtonHTMLAttributes, ReactNode } from "react"

import { cx } from "~/lib/cx"
import type { ClassValue } from "~/lib/cx"

import styles from "./Surface.module.css"

export type CardTone = "default" | "elevated" | "feature"

export type CardProps = Readonly<{
  tone?: CardTone
  elevated?: boolean
  children: ReactNode
}>

const toneClass = (tone: CardTone): ClassValue =>
  tone === "elevated" ? styles.cardElevated : tone === "feature" ? styles.cardFeature : false

export const Card = ({ tone, elevated = false, children }: CardProps): React.ReactElement => {
  const resolved: CardTone = tone ?? (elevated ? "elevated" : "default")
  return (
    <div className={styles.shell}>
      <div className={cx(styles.card, toneClass(resolved))}>{children}</div>
    </div>
  )
}

export type InteractiveCardProps = Readonly<{
  tone?: CardTone
  children: ReactNode
}> &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children">

export const InteractiveCard = ({
  tone = "default",
  children,
  type = "button",
  ...rest
}: InteractiveCardProps): React.ReactElement => (
  <div className={styles.shell}>
    <button
      {...rest}
      type={type}
      className={cx(styles.card, styles.interactive, toneClass(tone))}
    >
      {children}
    </button>
  </div>
)

export const Eyebrow = ({ children }: Readonly<{ children: ReactNode }>): React.ReactElement => (
  <span className={styles.eyebrow}>{children}</span>
)
