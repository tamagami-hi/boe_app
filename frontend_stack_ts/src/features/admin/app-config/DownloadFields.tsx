import { Section } from "~/app/layouts/Section"
import { Card } from "~/ui/primitives/Card"
import { FormField, Input } from "~/ui/primitives/FormField"
import { ADMIN_FORM_GRID } from "~/ui/recipes/admin"

import { sectionOf, textOf, URL_MAX, withText, type DownloadKey, type DraftEditorProps, type FieldProblems } from "./configDraft"

const DOWNLOAD_FIELDS: readonly Readonly<{ key: DownloadKey; label: string }>[] = [
  { key: "androidUrl", label: "Android download address" },
  { key: "iosUrl", label: "iOS download address" },
]

export type DownloadFieldsProps = DraftEditorProps & Readonly<{ problems: FieldProblems }>

export const DownloadFields = ({ draft, disabled, onChange, problems }: DownloadFieldsProps): React.ReactElement => {
  const downloads = sectionOf(draft, "downloads")
  return (
    <Section
      title="Downloads"
      description="Download addresses kept in the configuration. Released apps get updates from the release feed and do not read these yet. Addresses must start with https://."
    >
      <Card>
        <div className={ADMIN_FORM_GRID}>
          {DOWNLOAD_FIELDS.map(({ key, label }) => (
            <FormField key={key} label={label} error={problems[`downloads.${key}`]}>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={URL_MAX}
                  value={textOf(downloads, key)}
                  disabled={disabled}
                  invalid={invalid}
                  {...(describedBy === undefined ? {} : { "aria-describedby": describedBy })}
                  onChange={(event) => {
                    onChange(withText(draft, "downloads", key, event.target.value.trim()))
                  }}
                />
              )}
            </FormField>
          ))}
        </div>
      </Card>
    </Section>
  )
}
