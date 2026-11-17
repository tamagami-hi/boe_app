import { paiseToRupeeText, parseRupeesToSafePaise } from "~/features/admin/client-values/rupeeAmount"
import { AmountInput } from "~/ui/primitives/AmountInput"
import { Button } from "~/ui/primitives/Button"
import { FormField, Input } from "~/ui/primitives/FormField"
import type { FieldErrors } from "~/api/errors"

import { ADMIN_FORM_GRID } from "~/ui/recipes/admin"
import { SELECT_BASE, TEXTAREA_BASE } from "~/ui/recipes/field"
import { ACTION_ROW } from "~/ui/recipes/layout"

import type { TermsInput } from "./fundQueries"

export const RISK_LEVELS = ["low", "moderate", "high", "very_high"] as const
export const RETURN_TIERS = ["low", "moderate", "high"] as const

export type FundTerms = Readonly<{
  name: string
  category: string
  objective: string
  riskLevel: (typeof RISK_LEVELS)[number]
  returnTier: (typeof RETURN_TIERS)[number] | null
  minimumSipRupees: string
  minimumPurchaseRupees: string
  minimumDurationMonths: number | null
  recommendedHoldingMonths: number | null
  disclosure: Readonly<{ title: string; body: string }>
}>

export type FundTermsBody = Readonly<{
  name: string
  category: string
  objective: string
  riskLevel: FundTerms["riskLevel"]
  returnTier: FundTerms["returnTier"]
  minimumSipPaise: number
  minimumPurchasePaise: number
  minimumDurationMonths: number | null
  recommendedHoldingMonths: number | null
  disclosure: FundTerms["disclosure"]
}>

export const EMPTY_TERMS: FundTerms = {
  name: "",
  category: "",
  objective: "",
  riskLevel: "moderate",
  returnTier: "moderate",
  minimumSipRupees: "",
  minimumPurchaseRupees: "",
  minimumDurationMonths: null,
  recommendedHoldingMonths: null,
  disclosure: { title: "", body: "" },
}

const positiveOrNull = (value: string): number | null => {
  if (value.trim() === "") return null
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

const minimumPaiseOf = (rupees: string): number | null => (rupees === "" ? 0 : parseRupeesToSafePaise(rupees))

const MINIMUM_ERROR = "Enter rupees with at most two decimal places, or leave it empty for no minimum."

const minimumErrorOf = (rupees: string, serverError: string | undefined): string | undefined =>
  minimumPaiseOf(rupees) === null ? MINIMUM_ERROR : serverError

export const termsBodyOf = (terms: FundTerms): FundTermsBody | null => {
  const minimumSipPaise = minimumPaiseOf(terms.minimumSipRupees)
  const minimumPurchasePaise = minimumPaiseOf(terms.minimumPurchaseRupees)
  if (minimumSipPaise === null || minimumPurchasePaise === null) return null
  return {
    name: terms.name,
    category: terms.category,
    objective: terms.objective,
    riskLevel: terms.riskLevel,
    returnTier: terms.returnTier,
    minimumSipPaise,
    minimumPurchasePaise,
    minimumDurationMonths: terms.minimumDurationMonths,
    recommendedHoldingMonths: terms.recommendedHoldingMonths,
    disclosure: terms.disclosure,
  }
}

export const termsOfBody = (body: TermsInput): FundTerms => ({
  name: body.name,
  category: body.category,
  objective: body.objective ?? "",
  riskLevel: body.riskLevel,
  returnTier: body.returnTier ?? null,
  minimumSipRupees: paiseToRupeeText(String(body.minimumSipPaise ?? 0)),
  minimumPurchaseRupees: paiseToRupeeText(String(body.minimumPurchasePaise ?? 0)),
  minimumDurationMonths: body.minimumDurationMonths ?? null,
  recommendedHoldingMonths: body.recommendedHoldingMonths ?? null,
  disclosure: body.disclosure,
})

export type FundTermsFieldsProps = Readonly<{
  terms: FundTerms
  fields: FieldErrors | null
  setTerms: (next: FundTerms) => void
  disabled?: boolean
}>

export const FundTermsFields = ({
  terms,
  fields,
  setTerms,
  disabled = false,
}: FundTermsFieldsProps): React.ReactElement => (
  <>
    <div className={ADMIN_FORM_GRID}>
      <FormField
        label="Name"
        required
        {...(fields?.["terms.name"]?.[0] === undefined
          ? {}
          : { error: fields["terms.name"][0] })}
      >
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            disabled={disabled}
            required
            value={terms.name}
            invalid={invalid}
            {...(describedBy === undefined ? {} : { "aria-describedby": describedBy })}
            onChange={(event) => {
              setTerms({ ...terms, name: event.target.value })
            }}
          />
        )}
      </FormField>

      <FormField label="Category" required>
        {({ id, invalid }) => (
          <Input
            id={id}
            disabled={disabled}
            required
            value={terms.category}
            invalid={invalid}
            onChange={(event) => {
              setTerms({ ...terms, category: event.target.value })
            }}
          />
        )}
      </FormField>

      <FormField label="Risk level" required>
        {({ id }) => (
          <select
            id={id}
            disabled={disabled}
            className={SELECT_BASE}
            value={terms.riskLevel}
            onChange={(event) => {
              setTerms({ ...terms, riskLevel: event.target.value as FundTerms["riskLevel"] })
            }}
          >
            {RISK_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level.replace("_", " ")}
              </option>
            ))}
          </select>
        )}
      </FormField>

      <FormField label="Return tier" required>
        {({ id }) => (
          <select
            id={id}
            disabled={disabled}
            className={SELECT_BASE}
            value={terms.returnTier ?? ""}
            onChange={(event) => {
              setTerms({
                ...terms,
                returnTier: event.target.value === "" ? null : (event.target.value as NonNullable<FundTerms["returnTier"]>),
              })
            }}
          >
            <option value="">Not set</option>
            {RETURN_TIERS.map((tier) => (
              <option key={tier} value={tier}>
                {tier}
              </option>
            ))}
          </select>
        )}
      </FormField>

      <FormField
        label="Minimum lump sum"
        hint="In rupees, up to two decimal places. Leave it empty for no minimum."
        error={minimumErrorOf(terms.minimumPurchaseRupees, fields?.["terms.minimumPurchasePaise"]?.[0])}
      >
        {({ id, describedBy, invalid }) => (
          <AmountInput
            id={id}
            disabled={disabled}
            decimals
            value={terms.minimumPurchaseRupees}
            invalid={invalid}
            describedBy={describedBy}
            onChange={(next) => {
              setTerms({ ...terms, minimumPurchaseRupees: next })
            }}
          />
        )}
      </FormField>

      <FormField
        label="Minimum SIP"
        hint="In rupees, up to two decimal places. Leave it empty for no minimum."
        error={minimumErrorOf(terms.minimumSipRupees, fields?.["terms.minimumSipPaise"]?.[0])}
      >
        {({ id, describedBy, invalid }) => (
          <AmountInput
            id={id}
            disabled={disabled}
            decimals
            value={terms.minimumSipRupees}
            invalid={invalid}
            describedBy={describedBy}
            onChange={(next) => {
              setTerms({ ...terms, minimumSipRupees: next })
            }}
          />
        )}
      </FormField>

      <FormField label="Minimum duration (months)" hint="Leave blank for none.">
        {({ id }) => (
          <Input
            id={id}
            disabled={disabled}
            mono
            inputMode="numeric"
            value={terms.minimumDurationMonths === null ? "" : String(terms.minimumDurationMonths)}
            onChange={(event) => {
              setTerms({ ...terms, minimumDurationMonths: positiveOrNull(event.target.value) })
            }}
          />
        )}
      </FormField>

      <FormField label="Recommended holding (months)" hint="Leave blank for none.">
        {({ id }) => (
          <Input
            id={id}
            disabled={disabled}
            mono
            inputMode="numeric"
            value={
              terms.recommendedHoldingMonths === null
                ? ""
                : String(terms.recommendedHoldingMonths)
            }
            onChange={(event) => {
              setTerms({ ...terms, recommendedHoldingMonths: positiveOrNull(event.target.value) })
            }}
          />
        )}
      </FormField>
    </div>

    <FormField label="Objective" hint="Shown to investors on the fund page.">
      {({ id }) => (
        <textarea
          id={id}
          disabled={disabled}
          className={TEXTAREA_BASE}
          value={terms.objective}
          onChange={(event) => {
            setTerms({ ...terms, objective: event.target.value })
          }}
        />
      )}
    </FormField>

    <FormField label="Disclosure title" required>
      {({ id, invalid }) => (
        <Input
          id={id}
          disabled={disabled}
          required
          value={terms.disclosure.title}
          invalid={invalid}
          onChange={(event) => {
            setTerms({
              ...terms,
              disclosure: { ...terms.disclosure, title: event.target.value },
            })
          }}
        />
      )}
    </FormField>

    <FormField label="Disclosure body" required hint="Required. Investors read this verbatim.">
      {({ id }) => (
        <textarea
          id={id}
          disabled={disabled}
          className={TEXTAREA_BASE}
          required
          value={terms.disclosure.body}
          onChange={(event) => {
            setTerms({
              ...terms,
              disclosure: { ...terms.disclosure, body: event.target.value },
            })
          }}
        />
      )}
    </FormField>
  </>
)

export const SubmitRow = ({
  label,
  pending,
  disabled = false,
}: Readonly<{ label: string; pending: boolean; disabled?: boolean }>): React.ReactElement => (
  <div className={ACTION_ROW}>
    <Button type="submit" size="lg" loading={pending} disabled={disabled}>
      {label}
    </Button>
  </div>
)
