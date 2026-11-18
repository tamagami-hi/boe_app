import { Section } from "~/app/layouts/Section"
import { toPaise } from "~/domain/money"
import { AdminTable } from "~/features/admin/shared/AdminTable"
import { MoneyFootnote } from "~/ui/patterns/MoneyFootnote"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Stat } from "~/ui/patterns/DataList"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { FormField, Input } from "~/ui/primitives/FormField"
import { ADMIN_FIGURE, ADMIN_FORM_GRID, ADMIN_SUMMARY_GRID } from "~/ui/recipes/admin"
import { PROSE_SM } from "~/ui/recipes/datalist"
import { STACK_LG } from "~/ui/recipes/layout"

import { refKey } from "./investmentGrowthApi"
import type { InvestmentGrowthEntry, InvestmentPart } from "./investmentGrowthApi"

type PartRow = InvestmentPart & Readonly<{ userId: string; key: string }>

const partRowsOf = (entries: readonly InvestmentGrowthEntry[]): PartRow[] =>
  entries.flatMap((entry) =>
    entry.parts.map((part) => ({ ...part, userId: entry.userId, key: `${entry.userId}|${refKey(part.ref)}` })),
  )

export type LeftOutRow = Readonly<{ key: string; client: string; investment: string }>

export type ValueUpdatePreviewProps = Readonly<{
  entries: readonly InvestmentGrowthEntry[]
  skippedClientCount: number
  leftOut: readonly LeftOutRow[]
  totalDeltaPaise: string
  nameOf: (userId: string) => string
  effectiveDate: string
  today: string
  note: string
  locked: boolean
  showCommit: boolean
  committing: boolean
  onEffectiveDate: (value: string) => void
  onNote: (value: string) => void
  onReview: () => void
}>

export const ValueUpdatePreview = ({
  entries,
  skippedClientCount,
  leftOut,
  totalDeltaPaise,
  nameOf,
  effectiveDate,
  today,
  note,
  locked,
  showCommit,
  committing,
  onEffectiveDate,
  onNote,
  onReview,
}: ValueUpdatePreviewProps): React.ReactElement => {
  const futureDated = effectiveDate > today
  const parts = partRowsOf(entries)
  return (
    <>
      <Section
        title="What this would write"
        description="These figures were worked out again from the saved positions. Committing is refused if any position in the fund has changed since."
      >
        <Card>
          <div className={ADMIN_SUMMARY_GRID}>
            <Stat label="Clients updated">
              <span className={ADMIN_FIGURE}>{String(entries.length)}</span>
            </Stat>
            <Stat label="Investments updated">
              <span className={ADMIN_FIGURE}>{String(parts.length)}</span>
            </Stat>
            <Stat label="Categorise first" hint="Left out of this batch.">
              <span className={ADMIN_FIGURE}>{String(skippedClientCount)}</span>
            </Stat>
            <Stat label="Left out by the server" hint="Typed rows the server will not change.">
              <span className={ADMIN_FIGURE}>{String(leftOut.length)}</span>
            </Stat>
            <Stat label="Total change">
              <MoneyValue
                amount={toPaise(totalDeltaPaise)}
                size="md"
                tone="signed"
                showSign
                showDecimals
              />
            </Stat>
          </div>
        </Card>
        <AdminTable
          caption="Value updates in this batch, per investment"
          rows={parts}
          rowKey={(row) => row.key}
          columns={[
            { key: "client", header: "Client", render: (row) => nameOf(row.userId) },
            { key: "investment", header: "Investment", render: (row) => row.label },
            {
              key: "invested",
              header: "Invested",
              numeric: true,
              render: (row) => <MoneyValue amount={toPaise(row.investedPaise)} size="sm" showDecimals />,
            },
            {
              key: "before",
              header: "Value now",
              numeric: true,
              render: (row) => <MoneyValue amount={toPaise(row.beforePaise)} size="sm" showDecimals />,
            },
            {
              key: "change",
              header: "Change",
              numeric: true,
              render: (row) => (
                <MoneyValue amount={toPaise(row.deltaPaise)} size="sm" tone="signed" showSign showDecimals />
              ),
            },
            {
              key: "after",
              header: "Value after",
              numeric: true,
              render: (row) => <MoneyValue amount={toPaise(row.afterPaise)} size="sm" showDecimals />,
            },
          ]}
        />
        {leftOut.length === 0 ? null : (
          <ul className={PROSE_SM}>
            {leftOut.map((row) => (
              <li key={row.key}>{`${row.client}, ${row.investment}: left out by the server, nothing is written for it.`}</li>
            ))}
          </ul>
        )}
        <MoneyFootnote lastUpdated={null} />
      </Section>

      <Section
        title="Commit the batch"
        description="One value-update record is written for each client and fund, made of the per-investment changes above. Each client is told in the app, and active clients by email."
      >
        <Card>
          <div className={STACK_LG}>
            <div className={ADMIN_FORM_GRID}>
              <FormField
                label="Effective date"
                required
                hint="Decides which month's statement these updates land in."
                error={futureDated ? "The effective date cannot be later than today in India." : undefined}
              >
                {({ id }) => (
                  <Input
                    id={id}
                    type="date"
                    max={today}
                    value={effectiveDate}
                    disabled={locked}
                    onChange={(event) => {
                      onEffectiveDate(event.target.value)
                    }}
                  />
                )}
              </FormField>
              <FormField label="Note" hint="Internal. Recorded on the batch, never shown to clients.">
                {({ id }) => (
                  <Input
                    id={id}
                    value={note}
                    maxLength={2_000}
                    disabled={locked}
                    onChange={(event) => {
                      onNote(event.target.value)
                    }}
                  />
                )}
              </FormField>
            </div>
            <p className={PROSE_SM}>
              A mistake is corrected later with a reversal on the client&apos;s record, not by editing.
            </p>
            {showCommit ? (
              <Button
                disabled={locked || effectiveDate === "" || futureDated}
                loading={committing}
                onClick={onReview}
                trailing
              >
                {`Review and commit ${String(entries.length)} update(s)`}
              </Button>
            ) : null}
          </div>
        </Card>
      </Section>
    </>
  )
}
