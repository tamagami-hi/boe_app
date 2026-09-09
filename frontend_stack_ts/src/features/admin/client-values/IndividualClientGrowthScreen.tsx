import { useMemo, useState } from "react"

import { isApiError } from "~/api/errors"
import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { applyBasisPoints, toPaise } from "~/domain/money"
import {
  useAdminInvestorPositions,
  useAdminUsers,
  useIndividualClientGrowth,
} from "~/features/admin/shared/adminQueries"
import { useAdminFundCatalogue } from "~/features/admin/shared/queries"
import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Combobox } from "~/ui/primitives/Combobox"
import { Alert } from "~/ui/primitives/Feedback"
import { FormField, Input } from "~/ui/primitives/FormField"
import { RadioGroup } from "~/ui/primitives/Toggle"
import { Select } from "~/ui/primitives/Select"

import { ADMIN_CODE, ADMIN_FORM_GRID } from "~/ui/recipes/admin"
import { STACK_LG } from "~/ui/recipes/layout"

type Mode = "rate" | "amount"

const MIN_BASIS_POINTS = -2_000
const MAX_BASIS_POINTS = 2_000

const REASON_OPTIONS = [
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
] as const

const formatRate = (basisPoints: number): string =>
  `${basisPoints > 0 ? "+" : ""}${String(basisPoints / 100)}%`

const today = (): string => new Date().toISOString().slice(0, 10)

const IndividualClientGrowthScreen = (): React.ReactElement => {
  const funds = useAdminFundCatalogue()
  const growth = useIndividualClientGrowth()

  const [mode, setMode] = useState<Mode>("rate")
  const [userId, setUserId] = useState("")
  const [investorQuery, setInvestorQuery] = useState("")
  const [fundId, setFundId] = useState("")
  const [basisPoints, setBasisPoints] = useState("")
  const [amountPaise, setAmountPaise] = useState("")
  const [effectiveDate, setEffectiveDate] = useState(today)
  const [reasonCode, setReasonCode] = useState<string>("quarterly")
  const [note, setNote] = useState("")
  const [failure, setFailure] = useState<string | null>(null)

  const investors = useAdminUsers(investorQuery.trim() === "" ? {} : { q: investorQuery.trim() })
  const positions = useAdminInvestorPositions(userId)

  const fundName = (id: string): string => {
    const fund = (funds.data?.items ?? []).find((entry) => entry.id === id)
    return fund?.name ?? fund?.slug ?? id
  }

  const investorOptions = useMemo(
    () =>
      (investors.data?.items ?? []).map((user) => ({
        value: user.id,
        label: user.fullName === "" ? user.email : user.fullName,
        hint: [user.email, user.phone].filter((part) => part !== "").join(" · "),
      })),
    [investors.data],
  )

  const positionItems = positions.data?.items ?? []
  const fundOptions = [
    {
      value: "",
      label:
        userId === ""
          ? "Choose an investor first"
          : positionItems.length === 0
            ? "This investor holds no fund"
            : "Choose a fund",
    },
    ...positionItems.map((position) => ({
      value: position.fundId,
      label: fundName(position.fundId),
    })),
  ]

  const selectedPosition = positionItems.find((position) => position.fundId === fundId) ?? null

  const rate = Number(basisPoints)
  const rateInBand = Number.isInteger(rate) && rate !== 0 && rate >= MIN_BASIS_POINTS && rate <= MAX_BASIS_POINTS
  const invalidRate = mode === "rate" && !rateInBand
  const invalidAmount = mode === "amount" && !/^-?[1-9][0-9]*$/u.test(amountPaise)
  const incomplete =
    userId === "" ||
    fundId === "" ||
    reasonCode === "" ||
    effectiveDate === "" ||
    invalidRate ||
    invalidAmount

  const adjustment = useMemo(() => {
    if (selectedPosition === null) return null
    const current = BigInt(selectedPosition.currentValuePaise)
    if (mode === "amount") {
      if (invalidAmount) return null
      const delta = BigInt(amountPaise)
      return { delta, projected: current + delta }
    }
    if (invalidRate) return null
    const delta = BigInt(applyBasisPoints(toPaise(selectedPosition.principalPaise), rate))
    return { delta, projected: current + delta }
  }, [selectedPosition, mode, amountPaise, invalidAmount, invalidRate, rate])

  const submit = (): void => {
    setFailure(null)
    growth.mutate(
      {
        userId,
        fundId,
        effectiveDate,
        reasonCode,
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
        description="Appends a growth entry against one position. A rate is measured against the amount invested, so it does not compound; the amount invested itself never moves. Read the projected value before committing — the server recalculates it authoritatively and its response is the truth."
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
                    hint: "A percentage of the amount invested, in basis points. 250 is +2.5%. The rate never applies to the current value, so repeated adjustments do not compound.",
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

          <FormField
            label="Investor"
            required
            hint="Search by name, email or phone. Only investors with a holding can be adjusted."
          >
            {({ id }) => (
              <Combobox
                id={id}
                options={investorOptions}
                value={userId}
                onChange={(next) => {
                  setUserId(next)
                  setFundId("")
                }}
                query={investorQuery}
                onQueryChange={setInvestorQuery}
                placeholder="Start typing a name"
                loading={investors.isFetching}
                emptyLabel="No investor matches that"
              />
            )}
          </FormField>

          <FormField
            label="Fund"
            required
            hint="Only the funds this investor has actually invested in."
          >
            {({ id }) => (
              <Select
                id={id}
                options={fundOptions}
                value={fundId}
                disabled={userId === "" || positionItems.length === 0}
                onChange={(event) => {
                  setFundId(event.target.value)
                }}
              />
            )}
          </FormField>

          {selectedPosition === null ? null : (
            <DataList>
              <DetailRow label="Amount invested">
                <MoneyValue amount={toPaise(selectedPosition.principalPaise)} size="sm" />
              </DetailRow>
              <DetailRow label="Current value">
                <MoneyValue amount={toPaise(selectedPosition.currentValuePaise)} size="sm" />
              </DetailRow>
              <DetailRow label="Gain so far">
                <MoneyValue
                  amount={toPaise(selectedPosition.totalGrowthPaise)}
                  size="sm"
                  tone="signed"
                  showSign
                />
              </DetailRow>
              {mode === "rate" && rateInBand ? (
                <DetailRow label="Growth percentage">{formatRate(rate)}</DetailRow>
              ) : null}
              {adjustment === null ? null : (
                <>
                  <DetailRow
                    label={
                      mode === "rate" ? "Growth amount, taken from the invested amount" : "Growth amount"
                    }
                  >
                    <MoneyValue
                      amount={toPaise(adjustment.delta.toString())}
                      size="sm"
                      tone="signed"
                      showSign
                    />
                  </DetailRow>
                  <DetailRow label="Projected value after this adjustment">
                    <MoneyValue amount={toPaise(adjustment.projected.toString())} size="sm" />
                  </DetailRow>
                </>
              )}
            </DataList>
          )}

          {mode === "rate" ? (
            <FormField
              label="Rate in basis points"
              required
              hint="Between -2000 and 2000, and not zero. 500 is +5% of the amount invested."
              {...(invalidRate && basisPoints !== ""
                ? { error: "Enter a whole non-zero rate between -2000 and 2000 basis points." }
                : {})}
            >
              {({ id }) => (
                <Input
                  id={id}
                  type="number"
                  min={MIN_BASIS_POINTS}
                  max={MAX_BASIS_POINTS}
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

            <FormField label="Reason code" required hint="The period this growth covers.">
              {({ id }) => (
                <Select
                  id={id}
                  options={REASON_OPTIONS.map((option) => ({ ...option }))}
                  value={reasonCode}
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
              <DetailRow label="Amount invested">
                <MoneyValue amount={toPaise(growth.data.principalPaise)} size="sm" />
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
