import type { ButtonHTMLAttributes, ReactNode } from "react"

import { cx } from "~/lib/cx"
import {
  CARD_BASE,
  CARD_INTERACTIVE,
  CARD_TONE,
  EYEBROW,
  SHELL,
} from "~/ui/recipes/surface"

export type CardTone = "default" | "elevated" | "feature"

export type CardProps = Readonly<{
  tone?: CardTone
  elevated?: boolean
  children: ReactNode
}>

const toneClass = (tone: CardTone): string =>
  tone === "elevated"
    ? CARD_TONE.elevated
    : tone === "feature"
      ? CARD_TONE.feature
      : CARD_TONE.plain

export const Card = ({ tone, elevated = false, children }: CardProps): React.ReactElement => {
  const resolved: CardTone = tone ?? (elevated ? "elevated" : "default")
  return (
    <div className={SHELL}>
      <div className={cx(CARD_BASE, toneClass(resolved))}>{children}</div>
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
  <div className={SHELL}>
    <button
      {...rest}
      type={type}
      data-interactive=""
      className={cx(CARD_BASE, toneClass(tone), CARD_INTERACTIVE)}
    >
      {children}
    </button>
  </div>
)

export const Eyebrow = ({ children }: Readonly<{ children: ReactNode }>): React.ReactElement => (
  <span className={EYEBROW}>{children}</span>
)
