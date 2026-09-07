import { Link } from "react-router-dom"
import type { ReactNode } from "react"

import { cx } from "~/lib/cx"
import {
  BUTTON_BASE,
  BUTTON_SIZE,
  BUTTON_TONE,
  BUTTON_TRAIL,
  type ButtonSize,
  type ButtonTone,
} from "~/ui/recipes/button"

export type ButtonLinkProps = Readonly<{
  to: string
  tone?: ButtonTone
  size?: ButtonSize
  fullWidth?: boolean
  trailing?: boolean
  replace?: boolean
  disabled?: boolean
  children: ReactNode
}>

const TrailingGlyph = ({ tone }: Readonly<{ tone: ButtonTone }>): React.ReactElement => (
  <span className={BUTTON_TRAIL[tone]} aria-hidden="true">
    <svg
      className="size-[13px]"
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

export const ButtonLink = ({
  to,
  tone = "primary",
  size = "md",
  fullWidth = false,
  trailing = false,
  replace = false,
  disabled = false,
  children,
}: ButtonLinkProps): React.ReactElement => {
  const className = cx(
    BUTTON_BASE,
    BUTTON_TONE[tone],
    BUTTON_SIZE[size],
    fullWidth ? "w-full" : "w-auto self-start",
  )

  if (disabled) {
    return (
      <button type="button" className={className} disabled>
        {children}
      </button>
    )
  }

  return (
    <Link to={to} replace={replace} className={className}>
      {children}
      {trailing ? <TrailingGlyph tone={tone} /> : null}
    </Link>
  )
}
