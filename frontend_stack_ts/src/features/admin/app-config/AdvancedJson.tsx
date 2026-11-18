import { Disclosure } from "~/ui/patterns/DataList"
import { FormField } from "~/ui/primitives/FormField"
import { ADMIN_JSON_AREA } from "~/ui/recipes/admin"

export type AdvancedJsonProps = Readonly<{
  text: string
  isObject: boolean
  disabled: boolean
  onText: (next: string) => void
}>

export const AdvancedJson = ({ text, isObject, disabled, onText }: AdvancedJsonProps): React.ReactElement => (
  <Disclosure title="Advanced: the configuration as JSON">
    <FormField
      label="Configuration JSON"
      hint="The same configuration as the form above, which follows your edits here. Publishing replaces the whole configuration."
      {...(isObject ? {} : { error: "This is not a JSON object. The form stays as it was until it is." })}
    >
      {({ id, describedBy }) => (
        <textarea
          id={id}
          className={ADMIN_JSON_AREA}
          spellCheck={false}
          disabled={disabled}
          value={text}
          aria-invalid={!isObject}
          {...(describedBy === undefined ? {} : { "aria-describedby": describedBy })}
          onChange={(event) => {
            onText(event.target.value)
          }}
        />
      )}
    </FormField>
  </Disclosure>
)
