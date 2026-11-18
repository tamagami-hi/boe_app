import { useState } from "react"

import { Section } from "~/app/layouts/Section"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { FormField, Input } from "~/ui/primitives/FormField"
import { Switch } from "~/ui/primitives/Toggle"
import { ACTION_ROW, STACK_LG } from "~/ui/recipes/layout"

import { KEY_MAX, sectionOf, withEntry, type DraftEditorProps } from "./configDraft"

type KnownFlag = Readonly<{ key: string; label: string; hint: string; unsetHint: string }>

export const KNOWN_FLAGS: readonly KnownFlag[] = [
  {
    key: "onlinePayments",
    label: "Online payments in the client app",
    hint: "Off hides the pay and invest buttons in the client app.",
    unsetHint: "Not set, so the client app treats it as on.",
  },
]

const KNOWN_KEYS: ReadonlySet<string> = new Set(KNOWN_FLAGS.map((flag) => flag.key))

const UNKNOWN_HINT = "A flag this console has no description for. It keeps its value unless you change it."

export const FlagFields = ({ draft, disabled, onChange }: DraftEditorProps): React.ReactElement => {
  const flags = sectionOf(draft, "featureFlags")
  const [newKey, setNewKey] = useState("")
  const trimmed = newKey.trim()
  const isTaken = trimmed !== "" && Object.hasOwn(flags, trimmed)
  const others = Object.keys(flags).filter((key) => !KNOWN_KEYS.has(key))

  const set = (key: string, value: boolean | undefined): void => {
    onChange(withEntry(draft, "featureFlags", key, value))
  }

  return (
    <Section title="Feature flags" description="Switches the apps read by name.">
      <Card>
        <div className={STACK_LG}>
          <div>
            {KNOWN_FLAGS.map((flag) => (
              <Switch
                key={flag.key}
                label={flag.label}
                hint={flags[flag.key] === undefined ? `${flag.hint} ${flag.unsetHint}` : flag.hint}
                checked={flags[flag.key] !== false}
                disabled={disabled}
                onChange={(next) => {
                  set(flag.key, next)
                }}
              />
            ))}
            {others.map((key) => (
              <div key={key}>
                <Switch
                  label={key}
                  hint={UNKNOWN_HINT}
                  checked={flags[key] === true}
                  disabled={disabled}
                  onChange={(next) => {
                    set(key, next)
                  }}
                />
                <Button
                  tone="ghost"
                  size="sm"
                  disabled={disabled}
                  aria-label={`Remove the flag ${key}`}
                  onClick={() => {
                    set(key, undefined)
                  }}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
          <FormField
            label="Add a flag"
            hint="Its name exactly as the apps read it. A new flag starts off."
            {...(isTaken ? { error: "That flag is already listed." } : {})}
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                mono
                value={newKey}
                maxLength={KEY_MAX}
                disabled={disabled}
                invalid={invalid}
                autoComplete="off"
                spellCheck={false}
                {...(describedBy === undefined ? {} : { "aria-describedby": describedBy })}
                onChange={(event) => {
                  setNewKey(event.target.value)
                }}
              />
            )}
          </FormField>
          <div className={ACTION_ROW}>
            <Button
              tone="secondary"
              size="sm"
              disabled={disabled || trimmed === "" || isTaken}
              onClick={() => {
                set(trimmed, false)
                setNewKey("")
              }}
            >
              Add the flag
            </Button>
          </div>
        </div>
      </Card>
    </Section>
  )
}
