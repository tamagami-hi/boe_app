import type { TextareaHTMLAttributes } from "react"

import { cx } from "~/lib/cx"

import styles from "./Controls.module.css"

export type TextareaProps = Readonly<{ invalid?: boolean }> &
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className">

export const Textarea = ({ invalid = false, ...rest }: TextareaProps): React.ReactElement => (
  <textarea
    {...rest}
    className={cx(styles.textarea, invalid && styles.textareaInvalid)}
    aria-invalid={invalid}
  />
)
