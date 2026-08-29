import { useState } from "react"

import { isApiError } from "~/api/errors"
import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { toPaise } from "~/domain/money"
import { useIndividualClientGrowth } from "~/features/admin/shared/adminQueries"
import { useAdminFundCatalogue } from "~/features/admin/shared/queries"
import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert } from "~/ui/primitives/Feedback"
import { FormField, Input } from "~/ui/primitives/FormField"
import { RadioGroup } from "~/ui/primitives/Toggle"
import { Select } from "~/ui/primitives/Select"

import { ADMIN_CODE, ADMIN_FORM_GRID } from "~/ui/recipes/admin"
import { STACK_LG } from "~/ui/recipes/layout"

type Mode = "rate" | "amount"

const today = (): string => new Date().toISOString().slice(0, 10)

const IndividualClientGrowthScreen = (): React.ReactElement => {
  const funds = useAdminFundCatalogue()
  const growth = useIndividualClientGrowth()

  const [mode, setMode] = useState<Mode>("rate")
  const [userId, setUserId] = useState("")
  const [fundId, setFundId] = useState("")
  const [basisPoints, setBasisPoints] = useState("")
  const [amountPaise, setAmountPaise] = useState("")
  const [effectiveDate, setEffectiveDate] = useState(today)
  const [reasonCode, setReasonCode] = useState("quarterly_valuation")
  const [note, setNote] = useState("")
  const [failure, setFailure] = useState<string | null>(null)

  const fundOptions = [
    { value: "", label: "Choose a fund" },
    ...(funds.data?.items ?? []).map((fund) => ({ value: fund.id, label: fund.name ?? fund.slug })),
  ]

  const rate = Number(basisPoints)
  const invalidRate = mode === "rate" && (!Number.isInteger(rate) || rate === 0)
  const invalidAmount = mode === "amount" && !/^-?[1-9][0-9]*$/u.test(amountPaise)
  const incomplete =
    userId === "" ||
    fundId === "" ||
    reasonCode.trim() === "" ||
    effectiveDate === "" ||
    invalidRate ||
    invalidAmount

  const submit = (): void => {
    setFailure(null)
    growth.mutate(
      {
        userId,
        fundId,
        effectiveDate,
        reasonCode: reasonCode.trim(),
        ...(note.trim() === "" ? {} : { note: note.trim() }),
        ...(mode === "rate" ? { growthBasisPoints: rate } : { growthPaise: amountPaise }),
      },
      {
        onError: (error) => {
          setFailure(
            isApiError(error)
              ? error.code === "RESOURCE_NOT_FOUND"
                ? "That investor has no contribution in that fund, so there is nothing to adjust."
                : error.message
              : "We could not record that adjustment. Nothing has changed.",
          )
        },
      },
    )
  }

  return (
    <Page width="default">
      <PageHeader
        title="Adjust one investor"
        description="Appends a single growth entry against one position. The investor is notified that their value changed, without an amount."
      />

      {failure === null ? null : (
        <Alert tone="error" title="Nothing changed">
          {failure}
        </Alert>
      )}

      {growth.data === undefined ? null : (
        <Alert tone="success" title="Adjustment recorded">
          The ledger entry is written and the investor has been notified.
        </Alert>
      )}

      <Card elevated>
        <div className={STACK_LG}>
          <FormField label="How are you adjusting it">
            {() => (
              <RadioGroup<Mode>
                legend="Adjustment mode"
                value={mode}
                onChange={setMode}
                options={[
                  {
                    value: "rate",
                    label: "By a rate",
                    hint: "Basis points. 250 is +2.5%. The server computes the amount and refuses a rate that rounds to nothing.",
                  },
                  {
                    value: "amount",
                    label: "By an exact amount",
                    hint: "Signed paise. Use this for a correction where the number is already known.",
                  },
                ]}
              />
            )}
          </FormField>

          <div className={ADMIN_FORM_GRID}>
            <FormField label="Investor id" required hint="The user id from the Users screen.">
              {({ id }) => (
                <Input
                  id={id}
                  value={userId}
                  onChange={(event) => {
                    setUserId(event.target.value.trim())
                  }}
                />
              )}
            </FormField>

            <FormField label="Fund" required>
              {({ id }) => (
                <Select
                  id={id}
                  options={fundOptions}
                  value={fundId}
                  onChange={(event) => {
                    setFundId(event.target.value)
                  }}
                />
              )}
            </FormField>
          </div>

          {mode === "rate" ? (
            <FormField
              label="Rate in basis points"
              required
              hint="Between -10000 and 100000, and not zero."
              {...(invalidRate && basisPoints !== ""
                ? { error: "Enter a whole non-zero number of basis points." }
                : {})}
            >
              {({ id }) => (
                <Input
                  id={id}
                  type="number"
                  value={basisPoints}
                  onChange={(event) => {
                    setBasisPoints(event.target.value)
                  }}
                />
              )}
            </FormField>
          ) : (
            <FormField
              label="Amount in paise"
              required
              hint="Signed integer paise. -50000 removes ₹500."
              {...(invalidAmount && amountPaise !== ""
                ? { error: "Enter a non-zero integer number of paise." }
                : {})}
            >
              {({ id }) => (
                <Input
                  id={id}
                  value={amountPaise}
                  onChange={(event) => {
                    setAmountPaise(event.target.value.trim())
                  }}
                />
              )}
            </FormField>
          )}

          <div className={ADMIN_FORM_GRID}>
            <FormField
              label="Effective date"
              required
              hint="Decides which month's statement it lands in."
            >
              {({ id }) => (
                <Input
                  id={id}
                  type="date"
                  value={effectiveDate}
                  onChange={(event) => {
                    setEffectiveDate(event.target.value)
                  }}
                />
              )}
            </FormField>

            <FormField label="Reason code" required>
              {({ id }) => (
                <Input
                  id={id}
                  value={reasonCode}
                  maxLength={80}
                  onChange={(event) => {
                    setReasonCode(event.target.value)
                  }}
                />
              )}
            </FormField>
          </div>

          <FormField label="Note" hint="Internal. Recorded on the batch, never shown to the investor.">
            {({ id }) => (
              <Input
                id={id}
                value={note}
                maxLength={2_000}
                onChange={(event) => {
                  setNote(event.target.value)
                }}
              />
            )}
          </FormField>

          <Button disabled={incomplete} loading={growth.isPending} onClick={submit} trailing>
            Append the adjustment
          </Button>
        </div>
      </Card>

      {growth.data === undefined ? null : (
        <Section title="What was written">
          <Card>
            <DataList>
              <DetailRow label="Batch">
                <span className={ADMIN_CODE}>{growth.data.batchId}</span>
              </DetailRow>
              <DetailRow label="Entry">
                <span className={ADMIN_CODE}>{growth.data.entryId}</span>
              </DetailRow>
              <DetailRow label="Value before">
                <MoneyValue amount={toPaise(growth.data.beforePaise)} size="sm" />
              </DetailRow>
              <DetailRow label="Adjustment">
                <MoneyValue
                  amount={toPaise(growth.data.deltaPaise)}
                  size="sm"
                  tone="signed"
                  showSign
                />
              </DetailRow>
              <DetailRow label="Value after">
                <MoneyValue amount={toPaise(growth.data.afterPaise)} size="sm" />
              </DetailRow>
              <DetailRow label="Effective date">{growth.data.effectiveDate}</DetailRow>
            </DataList>
          </Card>
        </Section>
      )}
    </Page>
  )
}

export default IndividualClientGrowthScreen
