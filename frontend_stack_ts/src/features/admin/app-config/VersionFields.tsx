import { Section } from "~/app/layouts/Section"
import { Card } from "~/ui/primitives/Card"
import { Alert } from "~/ui/primitives/Feedback"
import { FormField, Input } from "~/ui/primitives/FormField"
import { Textarea } from "~/ui/primitives/Textarea"
import { ADMIN_FORM_GRID } from "~/ui/recipes/admin"
import { STACK_LG } from "~/ui/recipes/layout"

import {
  baseVersion,
  sectionOf,
  textOf,
  UPDATE_MESSAGE_MAX,
  withText,
  type DraftEditorProps,
  type FieldProblems,
  type Platform,
  type VersionAbove,
} from "./configDraft"

type PlatformField = Readonly<{ platform: Platform; label: string; hint: string }>

export const PLATFORM_LABELS: Readonly<Record<Platform, string>> = { android: "Android", ios: "iOS", web: "Web" }

const PLATFORM_FIELDS: readonly PlatformField[] = [
  {
    platform: "android",
    label: "Android",
    hint: "Android apps below this version, the admin app included, must update before they can be used.",
  },
  { platform: "ios", label: "iOS", hint: "Kept for an iOS app. No released app checks it yet." },
  { platform: "web", label: "Web", hint: "Kept for the web app. No released app checks it yet." },
]

export type VersionAboveReleaseProps = Readonly<{ above: readonly VersionAbove[]; release: string }>

export const VersionAboveRelease = ({ above, release }: VersionAboveReleaseProps): React.ReactElement | null =>
  above.length === 0 ? null : (
    <Alert tone="warning" title="This would lock out every installed app">
      {above.map(({ platform, value }) => `${PLATFORM_LABELS[platform]} ${value}`).join(", ")}{" "}
      {above.length === 1 ? "is" : "are"} above the current release, {baseVersion(release)}, which this admin
      app is. Apps below the minimum must update before they can be used. Unless a newer release is already
      published, every installed app on that platform, this one included, would be locked out.
    </Alert>
  )

export type VersionFieldsProps = DraftEditorProps &
  Readonly<{ problems: FieldProblems; above: readonly VersionAbove[]; release: string }>

export const VersionFields = ({
  draft,
  disabled,
  onChange,
  problems,
  above,
  release,
}: VersionFieldsProps): React.ReactElement => {
  const minimums = sectionOf(draft, "minimumSupportedVersion")

  return (
    <Section
      title="Minimum app version"
      description="Apps below this version must update. Use three numbers, such as 0.18.3. Leave a field empty for no minimum."
    >
      <Card>
        <div className={STACK_LG}>
          <div className={ADMIN_FORM_GRID}>
            {PLATFORM_FIELDS.map(({ platform, label, hint }) => (
              <FormField key={platform} label={label} hint={hint} error={problems[`minimumSupportedVersion.${platform}`]}>
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    mono
                    inputMode="decimal"
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={32}
                    value={textOf(minimums, platform)}
                    disabled={disabled}
                    invalid={invalid}
                    {...(describedBy === undefined ? {} : { "aria-describedby": describedBy })}
                    onChange={(event) => {
                      onChange(withText(draft, "minimumSupportedVersion", platform, event.target.value.trim()))
                    }}
                  />
                )}
              </FormField>
            ))}
          </div>
          <VersionAboveRelease above={above} release={release} />
          <FormField
            label="Update message"
            hint={`Shown on the screen that asks for the update. Up to ${String(UPDATE_MESSAGE_MAX)} characters.`}
          >
            {({ id, describedBy, invalid }) => (
              <Textarea
                id={id}
                rows={3}
                maxLength={UPDATE_MESSAGE_MAX}
                value={textOf(minimums, "message")}
                disabled={disabled}
                invalid={invalid}
                {...(describedBy === undefined ? {} : { "aria-describedby": describedBy })}
                onChange={(event) => {
                  onChange(withText(draft, "minimumSupportedVersion", "message", event.target.value))
                }}
              />
            )}
          </FormField>
        </div>
      </Card>
    </Section>
  )
}
