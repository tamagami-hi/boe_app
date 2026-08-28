import { useState } from "react"

import { Button } from "~/ui/primitives/Button"
import { FormField, Input } from "~/ui/primitives/FormField"
import type { FieldErrors } from "~/api/errors"

import styles from "~/features/admin/shared/Admin.module.css"

export const RISK_LEVELS = ["low", "moderate", "high", "very_high"] as const
export const RETURN_TIERS = ["low", "moderate", "high"] as const

export type FundTerms = Readonly<{
  name: string
  category: string
  objective: string
  riskLevel: (typeof RISK_LEVELS)[number]
  returnTier: (typeof RETURN_TIERS)[number]
  minimumSipPaise: number
  minimumPurchasePaise: number
  minimumDurationMonths: number | null
  recommendedHoldingMonths: number | null
  disclosure: Readonly<{ title: string; body: string }>
}>

export const EMPTY_TERMS: FundTerms = {
  name: "",
  category: "",
  objective: "",
  riskLevel: "moderate",
  returnTier: "moderate",
  minimumSipPaise: 0,
  minimumPurchasePaise: 0,
  minimumDurationMonths: null,
  recommendedHoldingMonths: null,
  disclosure: { title: "", body: "" },
}

const positiveOrNull = (value: string): number | null => {
  if (value.trim() === "") return null
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

const nonNegative = (value: string): number => {
  const parsed = Number.parseInt(value, 10)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0
}

export type FundTermsFormProps = Readonly<{
  initial?: FundTerms
  fields: FieldErrors | null
  onChange: (terms: FundTerms) => void
}>

export const useFundTerms = (initial: FundTerms = EMPTY_TERMS) => useState<FundTerms>(initial)

export const FundTermsFields = ({
  terms,
  fields,
  setTerms,
}: Readonly<{
  terms: FundTerms
  fields: FieldErrors | null
  setTerms: (next: FundTerms) => void
}>): React.ReactElement => (
  <>
    <div className={styles.formGrid}>
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
            className={styles.select}
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
            className={styles.select}
            value={terms.returnTier}
            onChange={(event) => {
              setTerms({ ...terms, returnTier: event.target.value as FundTerms["returnTier"] })
            }}
          >
            {RETURN_TIERS.map((tier) => (
              <option key={tier} value={tier}>
                {tier}
              </option>
            ))}
          </select>
        )}
      </FormField>

      <FormField label="Minimum lump sum (paise)" hint="Integer paise. 0 means no minimum.">
        {({ id }) => (
          <Input
            id={id}
            mono
            inputMode="numeric"
            value={String(terms.minimumPurchasePaise)}
            onChange={(event) => {
              setTerms({ ...terms, minimumPurchasePaise: nonNegative(event.target.value) })
            }}
          />
        )}
      </FormField>

      <FormField label="Minimum SIP (paise)" hint="Integer paise. 0 means no minimum.">
        {({ id }) => (
          <Input
            id={id}
            mono
            inputMode="numeric"
            value={String(terms.minimumSipPaise)}
            onChange={(event) => {
              setTerms({ ...terms, minimumSipPaise: nonNegative(event.target.value) })
            }}
          />
        )}
      </FormField>

      <FormField label="Minimum duration (months)" hint="Leave blank for none.">
        {({ id }) => (
          <Input
            id={id}
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
          className={styles.textarea}
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
          className={styles.textarea}
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
}: Readonly<{ label: string; pending: boolean }>): React.ReactElement => (
  <div className={styles.actions}>
    <Button type="submit" size="lg" loading={pending}>
      {label}
    </Button>
  </div>
)
