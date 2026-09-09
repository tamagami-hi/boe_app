import { useEffect, useId, useRef, useState } from "react"

import { cx } from "~/lib/cx"
import {
  COMBOBOX_EMPTY,
  COMBOBOX_INPUT,
  COMBOBOX_OPTION,
  COMBOBOX_OPTION_ACTIVE,
  COMBOBOX_OPTION_HINT,
  COMBOBOX_PANEL,
  COMBOBOX_WRAP,
  CONTROL_LABEL,
  FIELD_INVALID,
} from "~/ui/recipes/field"

export type ComboboxOption = Readonly<{
  value: string
  label: string
  hint?: string
}>

export type ComboboxProps = Readonly<{
  id?: string
  options: readonly ComboboxOption[]
  value: string
  onChange: (value: string) => void
  query: string
  onQueryChange: (query: string) => void
  placeholder?: string
  invalid?: boolean
  disabled?: boolean
  loading?: boolean
  emptyLabel?: string
}>

export const Combobox = ({
  id,
  options,
  value,
  onChange,
  query,
  onQueryChange,
  placeholder,
  invalid = false,
  disabled = false,
  loading = false,
  emptyLabel = "No matches",
}: ComboboxProps): React.ReactElement => {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const listId = `${inputId}-listbox`
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const wrap = useRef<HTMLDivElement>(null)

  const selected = options.find((option) => option.value === value) ?? null

  useEffect(() => {
    setActive(0)
  }, [query])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent): void => {
      if (wrap.current?.contains(event.target as Node) === true) return
      setOpen(false)
    }
    document.addEventListener("mousedown", onPointerDown)
    return () => {
      document.removeEventListener("mousedown", onPointerDown)
    }
  }, [open])

  const commit = (option: ComboboxOption): void => {
    onChange(option.value)
    onQueryChange(option.label)
    setOpen(false)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Escape") {
      setOpen(false)
      return
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      if (!open) {
        setOpen(true)
        return
      }
      if (options.length === 0) return
      const step = event.key === "ArrowDown" ? 1 : -1
      setActive((current) => (current + step + options.length) % options.length)
      return
    }
    if (event.key === "Enter" && open) {
      const option = options[active]
      if (option === undefined) return
      event.preventDefault()
      commit(option)
    }
  }

  return (
    <div className={COMBOBOX_WRAP} ref={wrap}>
      <input
        id={inputId}
        type="text"
        role="combobox"
        autoComplete="off"
        className={cx(COMBOBOX_INPUT, invalid ? FIELD_INVALID : undefined)}
        value={query}
        disabled={disabled}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={invalid}
        aria-activedescendant={
          open && options[active] !== undefined ? `${inputId}-option-${String(active)}` : undefined
        }
        {...(placeholder === undefined ? {} : { placeholder })}
        onChange={(event) => {
          onQueryChange(event.target.value)
          if (value !== "") onChange("")
          setOpen(true)
        }}
        onFocus={() => {
          setOpen(true)
        }}
        onKeyDown={onKeyDown}
      />

      {open ? (
        <div className={COMBOBOX_PANEL} id={listId} role="listbox">
          {loading && options.length === 0 ? (
            <p className={COMBOBOX_EMPTY}>Searching…</p>
          ) : options.length === 0 ? (
            <p className={COMBOBOX_EMPTY}>{emptyLabel}</p>
          ) : (
            options.map((option, index) => (
              <button
                key={option.value}
                type="button"
                id={`${inputId}-option-${String(index)}`}
                role="option"
                aria-selected={option.value === selected?.value}
                className={cx(COMBOBOX_OPTION, index === active ? COMBOBOX_OPTION_ACTIVE : undefined)}
                onMouseEnter={() => {
                  setActive(index)
                }}
                onClick={() => {
                  commit(option)
                }}
              >
                <span className={CONTROL_LABEL}>{option.label}</span>
                {option.hint === undefined ? null : (
                  <span className={COMBOBOX_OPTION_HINT}>{option.hint}</span>
                )}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}
