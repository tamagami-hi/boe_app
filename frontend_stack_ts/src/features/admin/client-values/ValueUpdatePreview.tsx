import { Section } from "~/app/layouts/Section"
import { toPaise } from "~/domain/money"
import { AdminTable } from "~/features/admin/shared/AdminTable"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Stat } from "~/ui/patterns/DataList"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { FormField, Input } from "~/ui/primitives/FormField"
import { ADMIN_FIGURE, ADMIN_FORM_GRID, ADMIN_SUMMARY_GRID } from "~/ui/recipes/admin"
import { PROSE_SM } from "~/ui/recipes/datalist"
import { STACK_LG } from "~/ui/recipes/layout"

import type { PreviewTarget } from "./valueUpdateSheet"

type PreviewRow = PreviewTarget & Readonly<{ afterPaise: string }>

export type ValueUpdatePreviewProps = Readonly<{
  targets: readonly PreviewRow[]
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
  targets,
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
  return (
    <>
      <Section
        title="What this would write"
        description="The server recomputed these numbers from the same positions. Committing is refused if any position in the fund moved since."
      >
        <Card>
          <div className={ADMIN_SUMMARY_GRID}>
            <Stat label="Clients updated">
              <span className={ADMIN_FIGURE}>{String(targets.length)}</span>
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
          caption="Value updates in this batch"
          rows={targets}
          rowKey={(row) => row.userId}
          columns={[
            { key: "client", header: "Client", render: (row) => nameOf(row.userId) },
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
      </Section>

      <Section
        title="Commit the batch"
        description="One value-update record is written for each client above, and each of them is notified."
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
                {`Review and commit ${String(targets.length)} update(s)`}
              </Button>
            ) : null}
          </div>
        </Card>
      </Section>
    </>
  )
}
