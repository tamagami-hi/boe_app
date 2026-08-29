import type { ButtonHTMLAttributes, ReactNode } from "react"

import { cx } from "~/lib/cx"
import {
  BUTTON_BASE,
  BUTTON_SIZE,
  BUTTON_SPINNER,
  BUTTON_TONE,
  BUTTON_TRAIL,
  type ButtonSize,
  type ButtonTone,
} from "~/ui/recipes/button"

export type { ButtonSize, ButtonTone }

export type ButtonProps = Readonly<{
  tone?: ButtonTone
  size?: ButtonSize
  loading?: boolean
  fullWidth?: boolean
  trailing?: boolean
  children: ReactNode
}> &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children">

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
    className={cx(
      BUTTON_BASE,
      BUTTON_TONE[tone],
      BUTTON_SIZE[size],
      fullWidth ? "w-full" : undefined,
    )}
    disabled={disabled === true || loading}
    aria-busy={loading}
  >
    {loading ? <span className={BUTTON_SPINNER} /> : null}
    {children}
    {trailing && !loading ? <TrailingGlyph tone={tone} /> : null}
  </button>
)
