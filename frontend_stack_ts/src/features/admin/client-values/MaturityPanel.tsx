import type { AdminInvestorPositionsData } from "@beonedge/contracts"
import { useState } from "react"

import { isApiError } from "~/api/errors"
import { Section } from "~/app/layouts/Section"
import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { toPaise } from "~/domain/money"
import { AdminTable } from "~/features/admin/shared/AdminTable"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert } from "~/ui/primitives/Feedback"
import { FormField, Input } from "~/ui/primitives/FormField"
import { Select } from "~/ui/primitives/Select"
import { ADMIN_FORM_GRID } from "~/ui/recipes/admin"
import { STACK_LG } from "~/ui/recipes/layout"

import { useMarkMaturity, useMaturityRecords, useSettleMaturity, useWithdrawalPayouts } from "./maturityQueries"
import { WithdrawalPayoutPanel } from "./WithdrawalPayoutPanel"

type Props = Readonly<{
  userId: string
  canWrite: boolean
  positions: AdminInvestorPositionsData["items"]
  fundName: (id: string) => string
}>
const today = (): string => new Date().toISOString().slice(0, 10)

export const MaturityPanel = ({ userId, canWrite, positions, fundName }: Props): React.ReactElement => {
  const maturities = useMaturityRecords(userId)
  const payouts = useWithdrawalPayouts(userId)
  const mark = useMarkMaturity(userId)
  const settle = useSettleMaturity(userId)
  const [fundId, setFundId] = useState("")
  const [date, setDate] = useState(today)
  const [amountPaise, setAmountPaise] = useState("")
  const [note, setNote] = useState("")
  const [action, setAction] = useState<"withdrawal" | "reinvestment" | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const items = maturities.data?.items ?? []
  const pending = items.find((row) => row.fundId === fundId && row.state === "pending")
  const position = positions.find((row) => row.fundId === fundId)
  const isBusy = mark.isPending || settle.isPending
  const isReady = canWrite && !isBusy && !maturities.isPending && !maturities.isError && fundId !== "" && date !== "" && date <= today()
  const isAmountValid = /^[1-9][0-9]*$/u.test(amountPaise) && position !== undefined && BigInt(amountPaise) <= BigInt(position.currentValuePaise)
  const error = mark.error ?? settle.error
  const changeFund = (next: string): void => {
    setFundId(next)
    setAmountPaise("")
    setSuccess(null)
    mark.reset()
    settle.reset()
  }
  const markMatured = (): void => {
    setSuccess(null)
    mark.mutate({ fundId, maturedOn: date, reasonCode: "position_matured", ...(note.trim() === "" ? {} : { note: note.trim() }) }, {
      onSuccess: () => { setSuccess("Position marked as matured. Choose withdrawal or reinvestment to settle it.") },
    })
  }
  const confirmSettlement = (): void => {
    const kind = action
    setAction(null)
    if (pending === undefined || kind === null) return
    setSuccess(null)
    const body = { fundId, effectiveDate: date, reasonCode: kind === "withdrawal" ? "maturity_withdrawal" : "maturity_reinvestment", ...(note.trim() === "" ? {} : { note: note.trim() }) }
    settle.mutate(kind === "withdrawal"
      ? { kind, maturityId: pending.id, body: { ...body, amountPaise } }
      : { kind, maturityId: pending.id, body }, {
      onSuccess: () => { setSuccess(kind === "withdrawal" ? "Withdrawal recorded. Confirm the bank transfer outcome below when available." : "Reinvestment recorded. The current value is now the new invested amount."); setAmountPaise("") },
    })
  }
  return (
    <Section title="Maturity and settlement" description="Mark a position as matured, then withdraw an amount or reinvest its full current value. Withdrawals use positive growth first.">
      <div className={STACK_LG}>
        {maturities.isError || payouts.isError ? <Alert tone="error" title="Records unavailable">Could not load maturity or payout records. Refresh before continuing.</Alert> : null}
        {error === null ? null : <Alert tone="error" title="Action not completed">{isApiError(error) ? error.message : "Could not save this action. Refresh and try again."}</Alert>}
        {success === null ? null : <Alert tone="success" title="Saved">{success}</Alert>}
        <Card elevated>
          <div className={STACK_LG}>
            <div className={ADMIN_FORM_GRID}>
              <FormField label="Position" required>{({ id }) => <Select id={id} value={fundId} options={[{ value: "", label: "Choose a fund position" }, ...positions.map((row) => ({ value: row.fundId, label: fundName(row.fundId) }))]} onChange={(event) => { changeFund(event.target.value) }} />}</FormField>
              <FormField label={pending === undefined ? "Maturity date" : "Settlement date"} required>{({ id }) => <Input id={id} type="date" value={date} max={today()} min={pending?.maturedOn} onChange={(event) => { setDate(event.target.value) }} />}</FormField>
            </div>
            {position === undefined ? null : <p>Current value: <MoneyValue amount={toPaise(position.currentValuePaise)} size="sm" /></p>}
            <FormField label="Note" hint="Optional context for the record.">{({ id }) => <Input id={id} value={note} maxLength={2000} onChange={(event) => { setNote(event.target.value) }} />}</FormField>
            {pending === undefined ? <Button disabled={!isReady || position === undefined || (BigInt(position.currentValuePaise) <= 0n && BigInt(position.principalPaise) <= 0n)} onClick={markMatured}>Mark matured</Button> : (
              <>
                <p>Matured on {pending.maturedOn}. A settlement uses the position&apos;s current value.</p>
                <FormField label="Withdrawal amount in paise" hint="Enter a positive amount up to the current value. Zero makes no withdrawal.">{({ id }) => <Input id={id} inputMode="numeric" value={amountPaise} onChange={(event) => { setAmountPaise(event.target.value.trim()) }} />}</FormField>
                <Button disabled={!isReady || !isAmountValid || date < pending.maturedOn} onClick={() => { setAction("withdrawal") }}>Record withdrawal</Button>
                <Button disabled={!isReady || position === undefined || position.currentValuePaise === position.principalPaise || date < pending.maturedOn} onClick={() => { setAction("reinvestment") }}>Reinvest full position</Button>
              </>
            )}
          </div>
        </Card>
        <AdminTable caption="Maturity history (latest 100)" rows={items} rowKey={(row) => row.id} columns={[
          { key: "fund", header: "Fund", render: (row) => fundName(row.fundId) },
          { key: "date", header: "Matured", render: (row) => row.maturedOn },
          { key: "value", header: "Value at maturity", render: (row) => <MoneyValue amount={toPaise(row.valueAtMaturityPaise)} size="sm" /> },
          { key: "state", header: "Status", render: (row) => row.settlement ?? row.state },
        ]} />
        <p>Withdrawal payouts (latest 100). Recording a withdrawal does not execute a bank transfer. Reversing a ledger entry does not mean transferred money has returned.</p>
        {(payouts.data?.items ?? []).map((payout) => <WithdrawalPayoutPanel key={payout.id} payout={payout} fundName={fundName(payout.fundId)} canWrite={canWrite} />)}
      </div>
      <ConfirmDialog open={action !== null} title={action === "withdrawal" ? "Record this withdrawal?" : "Reinvest this position?"} description={action === "withdrawal" ? "This reduces the investor's current value and creates a pending payout. The maturity will be settled, including for a partial withdrawal." : "The entire current value becomes the new invested amount. Any accumulated profit or loss is included, and the maturity will be settled."} confirmLabel="Confirm settlement" cancelLabel="Cancel" onConfirm={confirmSettlement} onCancel={() => { setAction(null) }} />
    </Section>
  )
}
