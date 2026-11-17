import { Section } from "~/app/layouts/Section"
import { toPaise } from "~/domain/money"
import { AdminTable } from "~/features/admin/shared/AdminTable"
import type { useAdminFundCatalogue } from "~/features/admin/shared/queries"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { Stat } from "~/ui/patterns/DataList"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"

import { ADMIN_CODE, ADMIN_FIGURE, ADMIN_FILTER, ADMIN_FILTER_ROW, ADMIN_LABEL, ADMIN_SUMMARY_GRID } from "~/ui/recipes/admin"
import { PROSE_SM } from "~/ui/recipes/datalist"
import { STACK_SM } from "~/ui/recipes/layout"

import type { CollectivePreview } from "./aumQueries"

type Catalogue = ReturnType<typeof useAdminFundCatalogue>
type CatalogueFund = NonNullable<Catalogue["data"]>["items"][number]

const initialisedFunds = (items: readonly CatalogueFund[]): readonly CatalogueFund[] =>
  items.filter((fund) => fund.aum !== null)

export const fundNamer =
  (funds: Catalogue) =>
  (fundId: string): string => {
    const fund = funds.data?.items.find((entry) => entry.id === fundId)
    if (fund !== undefined) return fund.name ?? fund.slug
    if (funds.error != null) return "Name not loaded"
    if (funds.data === undefined || funds.hasMore) return "Loading the name"
    return "Not in the fund list"
  }

export type CollectiveFundChoicesProps = Readonly<{
  funds: Catalogue
  selected: readonly string[]
  isLocked: boolean
  onToggle: (fundId: string) => void
}>

export const CollectiveFundChoices = ({ funds, selected, isLocked, onToggle }: CollectiveFundChoicesProps): React.ReactElement => (
  <AsyncBoundary
    query={funds}
    skeleton={<Skeleton height="2rem" width="60%" />}
    isEmpty={(data) => initialisedFunds(data.items).length === 0}
    empty={
      <p className={PROSE_SM}>
        No fund has a recorded size yet, so there is nothing to grow. Record a fund&apos;s opening AUM first.
      </p>
    }
  >
    {(data) => (
      <div className={STACK_SM}>
        {funds.error == null ? null : (
          <Alert
            tone="warning"
            title="The fund list may be incomplete"
            action={
              <Button tone="secondary" size="sm" onClick={funds.refetch}>
                Try again
              </Button>
            }
          >
            Some funds could not be loaded, so a fund you expect may be missing here.
          </Alert>
        )}
        <div className={ADMIN_FILTER_ROW}>
          {initialisedFunds(data.items).map((fund) => (
            <button
              key={fund.id}
              type="button"
              aria-pressed={selected.includes(fund.id)}
              className={ADMIN_FILTER}
              disabled={isLocked}
              onClick={() => {
                onToggle(fund.id)
              }}
            >
              {fund.name ?? fund.slug}
            </button>
          ))}
        </div>
      </div>
    )}
  </AsyncBoundary>
)

export type CollectivePlanProps = Readonly<{
  plan: CollectivePreview
  rate: number
  asOfDate: string
  nameFor: (fundId: string) => string
}>

export const CollectivePlan = ({ plan, rate, asOfDate, nameFor }: CollectivePlanProps): React.ReactElement => (
  <>
    <Section title="What this would do">
      <Card>
        <div className={ADMIN_SUMMARY_GRID}>
          <Stat label="Funds">
            <span className={ADMIN_FIGURE}>{String(plan.items.length)}</span>
          </Stat>
          <Stat label="Rate">
            <span className={ADMIN_FIGURE}>{`${String(rate)} bps`}</span>
          </Stat>
          <Stat label="As of">
            <span>{asOfDate}</span>
          </Stat>
        </div>
        <span className={ADMIN_LABEL}>Basis</span>
        <span className={ADMIN_CODE}>{plan.basisHash}</span>
      </Card>
    </Section>

    <Section title="Every fund in the batch">
      <AdminTable
        caption="Preview items"
        rows={plan.items}
        rowKey={(row) => row.fundId}
        columns={[
          { key: "fund", header: "Fund", render: (row) => nameFor(row.fundId) },
          { key: "revision", header: "Basis revision", numeric: true, render: (row) => String(row.basisRevision) },
          {
            key: "before",
            header: "Before",
            numeric: true,
            render: (row) => <MoneyValue amount={toPaise(row.beforeAumPaise)} size="sm" showDecimals />,
          },
          {
            key: "delta",
            header: "Change",
            numeric: true,
            render: (row) => <MoneyValue amount={toPaise(row.deltaPaise)} size="sm" tone="signed" showSign showDecimals />,
          },
          {
            key: "after",
            header: "After",
            numeric: true,
            render: (row) => <MoneyValue amount={toPaise(row.afterAumPaise)} size="sm" showDecimals />,
          },
        ]}
      />
    </Section>
  </>
)
