import { useId } from "react"
import type { InputHTMLAttributes, ReactNode } from "react"

import { cx } from "~/lib/cx"
import {
  FIELD_ERROR,
  FIELD_HINT,
  FIELD_LABEL,
  FIELD_REQUIRED,
  FIELD_ROOT,
  INPUT_BASE,
  INPUT_INVALID,
  INPUT_MONO,
} from "~/ui/recipes/field"

export type FormFieldRenderProps = Readonly<{
  id: string
  describedBy: string | undefined
  invalid: boolean
}>

export type FormFieldProps = Readonly<{
  label: string
  hint?: string
  error?: string
  required?: boolean
  children: (props: FormFieldRenderProps) => ReactNode
}>

export const FormField = ({
  label,
  hint,
  error,
  required = false,
  children,
}: FormFieldProps): React.ReactElement => {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedByParts: string[] = []
  if (hint !== undefined) describedByParts.push(hintId)
  if (error !== undefined) describedByParts.push(errorId)
  const describedBy = describedByParts.length === 0 ? undefined : describedByParts.join(" ")

  return (
    <div className={FIELD_ROOT}>
      <label className={FIELD_LABEL} htmlFor={id}>
        {label}
        {required ? (
          <span className={FIELD_REQUIRED} aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {children({ id, describedBy, invalid: error !== undefined })}
      {hint === undefined ? null : (
        <span className={FIELD_HINT} id={hintId}>
          {hint}
        </span>
      )}
      {error === undefined ? null : (
        <span className={FIELD_ERROR} id={errorId} role="alert">
          {error}
        </span>
      )}
    </div>
  )
}

export type InputProps = Readonly<{
  invalid?: boolean
  mono?: boolean
}> &
  Omit<InputHTMLAttributes<HTMLInputElement>, "className">

export const Input = ({
  invalid = false,
  mono = false,
  ...rest
}: InputProps): React.ReactElement => (
  <input
    {...rest}
    className={cx(INPUT_BASE, invalid ? INPUT_INVALID : undefined, mono ? INPUT_MONO : undefined)}
    aria-invalid={invalid}
  />
)
