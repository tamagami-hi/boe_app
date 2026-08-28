import { useId } from "react"
import type { InputHTMLAttributes, ReactNode } from "react"

import styles from "./Field.module.css"

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
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
        {required ? (
          <span className={styles.required} aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {children({ id, describedBy, invalid: error !== undefined })}
      {hint === undefined ? null : (
        <span className={styles.hint} id={hintId}>
          {hint}
        </span>
      )}
      {error === undefined ? null : (
        <span className={styles.error} id={errorId} role="alert">
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
}: InputProps): React.ReactElement => {
  const classes = [styles.input]
  if (invalid) classes.push(styles.invalid)
  if (mono) classes.push(styles.mono)
  return <input {...rest} className={classes.join(" ")} aria-invalid={invalid} />
}
