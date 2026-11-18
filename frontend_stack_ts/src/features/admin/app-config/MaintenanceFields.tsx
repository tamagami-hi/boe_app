import { Section } from "~/app/layouts/Section"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { FormField, Input } from "~/ui/primitives/FormField"
import { Textarea } from "~/ui/primitives/Textarea"
import { Switch } from "~/ui/primitives/Toggle"
import { ACTION_ROW, STACK_LG } from "~/ui/recipes/layout"

import {
  indiaInputOf,
  isoFromIndiaInput,
  MAINTENANCE_MESSAGE_MAX,
  sectionOf,
  textOf,
  withEntry,
  withText,
  type DraftEditorProps,
} from "./configDraft"

export const MaintenanceFields = ({ draft, disabled, onChange }: DraftEditorProps): React.ReactElement => {
  const maintenance = sectionOf(draft, "maintenance")
  const scheduledFor = textOf(maintenance, "scheduledFor")

  return (
    <Section
      title="Maintenance notice"
      description="A banner in every app. It does not stop the apps working, and nothing shows without a message."
    >
      <Card>
        <div className={STACK_LG}>
          <Switch
            label="Maintenance in progress"
            hint="On shows the banner now, starting with “Maintenance in progress”."
            checked={maintenance.enabled === true}
            disabled={disabled}
            onChange={(next) => {
              onChange(withEntry(draft, "maintenance", "enabled", next))
            }}
          />
          <FormField
            label="Message"
            hint={`What the banner says. Up to ${MAINTENANCE_MESSAGE_MAX.toLocaleString("en-IN")} characters.`}
          >
            {({ id, describedBy, invalid }) => (
              <Textarea
                id={id}
                rows={3}
                maxLength={MAINTENANCE_MESSAGE_MAX}
                value={textOf(maintenance, "message")}
                disabled={disabled}
                invalid={invalid}
                {...(describedBy === undefined ? {} : { "aria-describedby": describedBy })}
                onChange={(event) => {
                  onChange(withText(draft, "maintenance", "message", event.target.value))
                }}
              />
            )}
          </FormField>
          <FormField
            label="Planned start, India time"
            hint="Until then the banner reads “Planned maintenance from” this time. Leave empty for none."
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                type="datetime-local"
                value={indiaInputOf(scheduledFor)}
                disabled={disabled}
                invalid={invalid}
                {...(describedBy === undefined ? {} : { "aria-describedby": describedBy })}
                onChange={(event) => {
                  onChange(withEntry(draft, "maintenance", "scheduledFor", isoFromIndiaInput(event.target.value)))
                }}
              />
            )}
          </FormField>
          {scheduledFor === "" ? null : (
            <div className={ACTION_ROW}>
              <Button
                tone="ghost"
                size="sm"
                disabled={disabled}
                onClick={() => {
                  onChange(withEntry(draft, "maintenance", "scheduledFor", undefined))
                }}
              >
                Clear the planned start
              </Button>
            </div>
          )}
        </div>
      </Card>
    </Section>
  )
}
