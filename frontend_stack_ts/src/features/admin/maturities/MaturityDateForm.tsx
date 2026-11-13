import { useState } from "react"

import { HeldWriteNotice } from "~/features/admin/users/HeldWriteNotice"
import { useHeldWrite } from "~/features/admin/users/useHeldWrite"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert } from "~/ui/primitives/Feedback"
import { FormField, Input } from "~/ui/primitives/FormField"
import { Select } from "~/ui/primitives/Select"
import { ADMIN_FORM_GRID } from "~/ui/recipes/admin"
import { ACTION_ROW, STACK_LG } from "~/ui/recipes/layout"

import { formatMaturityDate } from "./maturityPresentation"
import { useEditMaturityDate, useSetMaturityDate, type MaturityScheduleItem } from "./maturityQueries"

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u
const EARLIEST = "2000-01-01"
const LATEST = "2199-12-31"

export type FundChoice = Readonly<{ fundId: string; label: string }>

export type MaturityDateFormProps = Readonly<{
  userId: string
  funds: readonly FundChoice[]
  editing: MaturityScheduleItem | null
  onReload: () => void
  onClose: () => void
}>

const isDate = (value: string): boolean => DATE_PATTERN.test(value) && value >= EARLIEST && value <= LATEST

export const MaturityDateForm = ({ userId, funds, editing, onReload, onClose }: MaturityDateFormProps): React.ReactElement => {
  const create = useHeldWrite(useSetMaturityDate(userId), "The date could not be sent. Reload the page and try again.")
  const edit = useHeldWrite(useEditMaturityDate(userId), "The date could not be sent. Reload the page and try again.")
  const write = editing === null ? create : edit
  const [fundId, setFundId] = useState(editing?.fundId ?? "")
  const [date, setDate] = useState(editing?.maturityDate ?? "")

  const locked = write.pending || write.outcome.kind === "unknown" || write.outcome.kind === "done"
  const ready = fundId !== "" && isDate(date) && date !== editing?.maturityDate

  if (write.outcome.kind === "done") {
    const saved = write.outcome.result
    return (
      <Alert
        tone="success"
        title={editing === null ? "Maturity date set" : "Maturity date changed"}
        action={
          <Button size="sm" tone="secondary" onClick={onClose}>
            Done
          </Button>
        }
      >
        {`${saved.fundName} matures on ${formatMaturityDate(saved.maturityDate)}. Nothing moves on that date by itself; the console reminds you from 30 days before it.`}
      </Alert>
    )
  }

  const submit = (): void => {
    if (editing === null) {
      create.submit({ fundId, maturityDate: date })
      return
    }
    edit.submit({ scheduleId: editing.scheduleId, expectedVersion: editing.version, maturityDate: date })
  }

  return (
    <Card elevated>
      <div className={STACK_LG}>
        <HeldWriteNotice write={write} subject="the maturity date was saved" onReload={onReload} />
        <div className={ADMIN_FORM_GRID}>
          <FormField label="Holding" required>
            {({ id }) => (
              <Select
                id={id}
                value={fundId}
                disabled={locked || editing !== null}
                options={[
                  { value: "", label: funds.length === 0 ? "No holding without a date" : "Choose a fund the client holds" },
                  ...funds.map((fund) => ({ value: fund.fundId, label: fund.label })),
                ]}
                onChange={(event) => {
                  setFundId(event.target.value)
                }}
              />
            )}
          </FormField>
          <FormField
            label="Maturity date"
            required
            hint="A future date is fine. The console starts reminding you 30 days before it."
            error={date !== "" && !isDate(date) ? "Choose a date from 2000 to 2199." : undefined}
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                type="date"
                value={date}
                min={EARLIEST}
                max={LATEST}
                disabled={locked}
                aria-describedby={describedBy}
                invalid={invalid}
                onChange={(event) => {
                  setDate(event.target.value)
                }}
              />
            )}
          </FormField>
        </div>
        <span className={ACTION_ROW}>
          <Button disabled={locked || !ready} loading={write.pending} onClick={submit}>
            {editing === null ? "Set the date" : "Change the date"}
          </Button>
          <Button tone="ghost" disabled={write.pending} onClick={onClose}>
            Cancel
          </Button>
        </span>
      </div>
    </Card>
  )
}
