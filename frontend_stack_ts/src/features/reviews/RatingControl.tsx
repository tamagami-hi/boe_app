import { RATING_OPTIONS, isRatingValue, type RatingValue } from "~/domain/reviews"
import { RadioGroup, type RadioOption } from "~/ui/primitives/Toggle"
import { FIELD_ERROR, FIELD_LABEL, FIELD_ROOT, FIELD_REQUIRED } from "~/ui/recipes/field"

type Props = Readonly<{
  value: RatingValue | null
  error: string | undefined
  disabled: boolean
  onChange: (next: RatingValue) => void
}>

const LEGEND = "Your rating"

export const RatingControl = ({ value, error, disabled, onChange }: Props): React.ReactElement => {
  const options: readonly RadioOption<string>[] = RATING_OPTIONS.map((option) => ({ ...option, disabled }))
  return (
    <div className={FIELD_ROOT}>
      <span className={FIELD_LABEL} aria-hidden="true">
        {LEGEND}
        <span className={FIELD_REQUIRED}>*</span>
      </span>
      <RadioGroup
        legend={error === undefined ? LEGEND : `${LEGEND}. ${error}`}
        value={value ?? ""}
        options={options}
        onChange={(next) => {
          if (isRatingValue(next)) onChange(next)
        }}
      />
      {error === undefined ? null : (
        <span className={FIELD_ERROR} role="alert">
          {error}
        </span>
      )}
    </div>
  )
}
