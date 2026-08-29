import type { TextareaHTMLAttributes } from "react"

import { cx } from "~/lib/cx"
import { TEXTAREA_BASE, TEXTAREA_INVALID } from "~/ui/recipes/field"

export type TextareaProps = Readonly<{ invalid?: boolean }> &
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className">

export const Textarea = ({ invalid = false, ...rest }: TextareaProps): React.ReactElement => (
  <textarea
    {...rest}
    className={cx(TEXTAREA_BASE, invalid ? TEXTAREA_INVALID : undefined)}
    aria-invalid={invalid}
  />
)
