import type { ReactNode } from "react"

import { cx } from "~/lib/cx"
import {
  CARD_BASE,
  CARD_TONE,
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

