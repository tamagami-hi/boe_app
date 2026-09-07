import type { TextareaHTMLAttributes } from "react"

import { cx } from "~/lib/cx"
import { FIELD_INVALID, TEXTAREA_BASE } from "~/ui/recipes/field"

export type TextareaProps = Readonly<{ invalid?: boolean }> &
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className">

export const Textarea = ({ invalid = false, ...rest }: TextareaProps): React.ReactElement => (
  <textarea
    {...rest}
    className={cx(TEXTAREA_BASE, invalid ? FIELD_INVALID : undefined)}
    aria-invalid={invalid}
  />
)
