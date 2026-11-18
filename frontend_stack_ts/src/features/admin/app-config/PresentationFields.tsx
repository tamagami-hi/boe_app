import { useEffect, useState } from "react"

import { Section } from "~/app/layouts/Section"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { FormField, Input } from "~/ui/primitives/FormField"
import { Select } from "~/ui/primitives/Select"
import { Switch } from "~/ui/primitives/Toggle"
import { ADMIN_CODE, ADMIN_FORM_GRID } from "~/ui/recipes/admin"
import { ACTION_ROW, STACK_LG } from "~/ui/recipes/layout"

import { KEY_MAX, PRESENTATION_TEXT_MAX, sectionOf, withEntry, type DraftEditorProps } from "./configDraft"

type EntryKind = "text" | "number" | "switch"

const KIND_OPTIONS: readonly Readonly<{ value: EntryKind; label: string }>[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "switch", label: "On or off" },
]

const STARTING_VALUE: Readonly<Record<EntryKind, string | number | boolean>> = { text: "", number: 0, switch: false }

const kindOf = (value: unknown): EntryKind =>
  typeof value === "number" ? "number" : typeof value === "boolean" ? "switch" : "text"

const isEntryKind = (value: string): value is EntryKind => KIND_OPTIONS.some((option) => option.value === value)

type ValueEditorProps = Readonly<{
  entryKey: string
  value: unknown
  disabled: boolean
  onValue: (next: string | number | boolean) => void
}>

const NumberEditor = ({ entryKey, value, disabled, onValue }: ValueEditorProps): React.ReactElement => {
  const [text, setText] = useState(String(value))
  const parsed = Number(text)
  const isValid = text.trim() !== "" && Number.isFinite(parsed)

  useEffect(() => {
    if (Number(text) !== value) setText(String(value))
  }, [value])

  return (
    <FormField label={`${entryKey}, number`} {...(isValid ? {} : { error: "Enter a number, such as 12 or 0.5." })}>
      {({ id, describedBy, invalid }) => (
        <Input
          id={id}
          mono
          inputMode="decimal"
          value={text}
          disabled={disabled}
          invalid={invalid}
          {...(describedBy === undefined ? {} : { "aria-describedby": describedBy })}
          onChange={(event) => {
            const next = event.target.value
            setText(next)
            if (next.trim() !== "" && Number.isFinite(Number(next))) onValue(Number(next))
          }}
        />
      )}
    </FormField>
  )
}

const ValueEditor = (props: ValueEditorProps): React.ReactElement => {
  const { entryKey, value, disabled, onValue } = props
  if (typeof value === "number") return <NumberEditor {...props} />
  if (typeof value === "boolean") {
    return <Switch label={entryKey} checked={value} disabled={disabled} onChange={onValue} />
  }
  return (
    <FormField label={`${entryKey}, text`}>
      {({ id, describedBy, invalid }) => (
        <Input
          id={id}
          maxLength={PRESENTATION_TEXT_MAX}
          value={typeof value === "string" ? value : ""}
          disabled={disabled}
          invalid={invalid}
          {...(describedBy === undefined ? {} : { "aria-describedby": describedBy })}
          onChange={(event) => {
            onValue(event.target.value)
          }}
        />
      )}
    </FormField>
  )
}

const AddEntry = ({ draft, disabled, onChange }: DraftEditorProps): React.ReactElement => {
  const [key, setKey] = useState("")
  const [kind, setKind] = useState<EntryKind>("text")
  const trimmed = key.trim()
  const isTaken = trimmed !== "" && Object.hasOwn(sectionOf(draft, "presentation"), trimmed)

  return (
    <div className={STACK_LG}>
      <div className={ADMIN_FORM_GRID}>
        <FormField label="New entry name" {...(isTaken ? { error: "That name is already listed." } : {})}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              mono
              autoComplete="off"
              spellCheck={false}
              maxLength={KEY_MAX}
              value={key}
              disabled={disabled}
              invalid={invalid}
              {...(describedBy === undefined ? {} : { "aria-describedby": describedBy })}
              onChange={(event) => {
                setKey(event.target.value)
              }}
            />
          )}
        </FormField>
        <FormField label="New entry type">
          {({ id }) => (
            <Select
              id={id}
              options={KIND_OPTIONS}
              value={kind}
              disabled={disabled}
              onChange={(event) => {
                if (isEntryKind(event.target.value)) setKind(event.target.value)
              }}
            />
          )}
        </FormField>
      </div>
      <div className={ACTION_ROW}>
        <Button
          tone="secondary"
          size="sm"
          disabled={disabled || trimmed === "" || isTaken}
          onClick={() => {
            onChange(withEntry(draft, "presentation", trimmed, STARTING_VALUE[kind]))
            setKey("")
          }}
        >
          Add the entry
        </Button>
      </div>
    </div>
  )
}

export const PresentationFields = ({ draft, disabled, onChange }: DraftEditorProps): React.ReactElement => {
  const entries = Object.entries(sectionOf(draft, "presentation"))
  const set = (key: string, value: unknown): void => {
    onChange(withEntry(draft, "presentation", key, value))
  }

  return (
    <Section title="Presentation" description="Named display settings the apps can read. Each is text, a number, or on or off.">
      <Card>
        <div className={STACK_LG}>
          {entries.map(([key, value]) => (
            <div key={key} className={STACK_LG}>
              <span className={ADMIN_CODE}>{key}</span>
              <div className={ADMIN_FORM_GRID}>
                <FormField label={`${key}, type`}>
                  {({ id }) => (
                    <Select
                      id={id}
                      options={KIND_OPTIONS}
                      value={kindOf(value)}
                      disabled={disabled}
                      onChange={(event) => {
                        if (isEntryKind(event.target.value)) set(key, STARTING_VALUE[event.target.value])
                      }}
                    />
                  )}
                </FormField>
                <ValueEditor
                  entryKey={key}
                  value={value}
                  disabled={disabled}
                  onValue={(next) => {
                    set(key, next)
                  }}
                />
              </div>
              <div className={ACTION_ROW}>
                <Button
                  tone="ghost"
                  size="sm"
                  disabled={disabled}
                  aria-label={`Remove the entry ${key}`}
                  onClick={() => {
                    set(key, undefined)
                  }}
                >
                  Remove
                </Button>
              </div>
            </div>
          ))}
          <AddEntry draft={draft} disabled={disabled} onChange={onChange} />
        </div>
      </Card>
    </Section>
  )
}
