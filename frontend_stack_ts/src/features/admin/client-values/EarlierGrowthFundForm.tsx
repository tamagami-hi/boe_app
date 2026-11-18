import type { AdminClientInvestment } from "@beonedge/contracts"
import { useState } from "react"

import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { formatDate } from "~/domain/dates"
import { formatINR, toPaise } from "~/domain/money"
import { DataList, DetailRow, Prose } from "~/ui/patterns/DataList"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { FormField, Input } from "~/ui/primitives/FormField"
import { ACTION_ROW } from "~/ui/recipes/layout"
import { META_TEXT } from "~/ui/recipes/text"

import { signedRupeeText, splitBodyOf, tallySplit, type SplitBody } from "./earlierGrowthSplit"
import { proposedAmountOf, refKey, type InvestmentRef, type SplittableFund } from "./investmentCleanup"

const dated = (isoDate: string): string => formatDate(`${isoDate}T00:00:00Z`)

const money = (paise: string): string => formatINR(toPaise(paise), { showDecimals: true })

export const investmentLabelOf = ({ label, amountPaise, date, reversed }: AdminClientInvestment): string =>
  [label, money(amountPaise), ...(date === null ? [] : [`from ${dated(date)}`]), ...(reversed ? ["reversed"] : [])].join(", ")

const remainderLine = (remainingPaise: string | null): string => {
  if (remainingPaise === null) return "Enter an amount for every investment, in rupees with up to two decimal places."
  if (remainingPaise === "0") return "The split adds up to the total."
  return remainingPaise.startsWith("-")
    ? `${money(remainingPaise.slice(1))} more than the total. Lower an amount to match it.`
    : `${money(remainingPaise)} still to place. Raise an amount to match the total.`
}

export type EarlierGrowthFundFormProps = Readonly<{
  fund: SplittableFund
  investorLabel: string
  busy: boolean
  onConfirm: (body: SplitBody<InvestmentRef>) => void
}>

export const EarlierGrowthFundForm = ({
  fund,
  investorLabel,
  busy,
  onConfirm,
}: EarlierGrowthFundFormProps): React.ReactElement => {
  const growth = fund.earlierGrowth
  const [texts, setTexts] = useState<readonly string[]>(() =>
    fund.investments.map((investment) => {
      const proposed = proposedAmountOf(growth, investment.ref)
      return proposed === null ? "" : signedRupeeText(proposed)
    }),
  )
  const [reviewing, setReviewing] = useState(false)
  const tally = tallySplit(growth.totalPaise, texts)
  const body = splitBodyOf(
    growth.cutoffEntryId,
    growth.totalPaise,
    fund.investments.map((investment) => investment.ref),
    texts,
  )

  return (
    <Card>
      <DataList>
        <DetailRow label="Fund">{fund.fundName}</DetailRow>
        <DetailRow label="Earlier growth to split" emphasis="lead">
          <MoneyValue amount={toPaise(growth.totalPaise)} size="sm" showDecimals />
        </DetailRow>
      </DataList>
      {fund.investments.map((investment, index) => (
        <FormField
          key={refKey(investment.ref)}
          label={investmentLabelOf(investment)}
          hint="In rupees, for example 1250.50, or -300 for a fall."
          required
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={texts[index] ?? ""}
              invalid={invalid}
              disabled={busy}
              aria-describedby={describedBy}
              onChange={(event) => {
                const next = event.target.value
                setTexts((current) => current.map((text, at) => (at === index ? next : text)))
              }}
            />
          )}
        </FormField>
      ))}
      <p className={META_TEXT} aria-live="polite">
        {tally.sumPaise === null
          ? remainderLine(null)
          : `Split so far ${money(tally.sumPaise)} of ${money(growth.totalPaise)}. ${remainderLine(tally.remainingPaise)}`}
      </p>
      <div className={ACTION_ROW}>
        <Button
          size="sm"
          disabled={busy || body === null}
          onClick={() => {
            setReviewing(true)
          }}
        >
          Confirm the split
        </Button>
      </div>
      <ConfirmDialog
        open={reviewing && body !== null}
        title="Confirm this split of the earlier growth?"
        confirmLabel="Confirm the split"
        onConfirm={() => {
          setReviewing(false)
          if (body !== null) onConfirm(body)
        }}
        onCancel={() => {
          setReviewing(false)
        }}
      >
        <DataList>
          <DetailRow label="Investor">{investorLabel}</DetailRow>
          <DetailRow label="Fund">{fund.fundName}</DetailRow>
          {fund.investments.map((investment, index) => (
            <DetailRow key={refKey(investment.ref)} label={investmentLabelOf(investment)}>
              <MoneyValue amount={toPaise(body?.parts[index]?.amountPaise ?? "0")} size="sm" showDecimals />
            </DetailRow>
          ))}
          <DetailRow label="Total" emphasis="lead">
            <MoneyValue amount={toPaise(growth.totalPaise)} size="sm" showDecimals />
          </DetailRow>
        </DataList>
        <Prose>
          Each investment keeps this share of the growth recorded before the cutoff, and the client&apos;s breakdown shows it.
          The fund&apos;s value does not change. A later split replaces this one. No email is sent.
        </Prose>
      </ConfirmDialog>
    </Card>
  )
}
