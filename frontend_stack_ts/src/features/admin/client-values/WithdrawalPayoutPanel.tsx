import type { AdminWithdrawalPayout } from "@beonedge/contracts"
import { useState } from "react"

import { isApiError } from "~/api/errors"
import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { toPaise } from "~/domain/money"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert } from "~/ui/primitives/Feedback"
import { FormField, Input } from "~/ui/primitives/FormField"
import { Select } from "~/ui/primitives/Select"
import { ADMIN_FORM_GRID } from "~/ui/recipes/admin"
import { STACK_LG } from "~/ui/recipes/layout"

import { useUpdatePayout } from "./maturityQueries"

type Props = Readonly<{ payout: AdminWithdrawalPayout; fundName: string; canWrite: boolean }>

export const WithdrawalPayoutPanel = ({ payout, fundName, canWrite }: Props): React.ReactElement => {
  const update = useUpdatePayout(payout.userId)
  const [state, setState] = useState<"paid" | "failed">("paid")
  const [reference, setReference] = useState("")
  const [isConfirming, setIsConfirming] = useState(false)
  const submit = (): void => {
    setIsConfirming(false)
    const expectedVersion = Number(payout.version)
    update.mutate({
      payoutId: payout.id,
      body: state === "paid"
        ? { state, expectedVersion, transferReference: reference.trim() }
        : { state, expectedVersion, failureCode: reference.trim() },
    })
  }
  return (
    <Card>
      <div className={STACK_LG}>
        <p>{fundName} · {payout.effectiveDate} · {payout.state}</p>
        <MoneyValue amount={toPaise(payout.amountPaise)} size="sm" />
        <p>{payout.transferReference ?? payout.failureCode ?? "Awaiting transfer confirmation"}</p>
        {payout.state === "failed" ? <Alert tone="info" title="Transfer failed">The withdrawal remains recorded. Reconcile the transfer separately; this status does not restore the investor&apos;s balance.</Alert> : null}
        {update.error === null ? null : <Alert tone="error" title="Status not updated">{isApiError(update.error) ? update.error.message : "Could not update the payout. Refresh and try again."}</Alert>}
        {payout.state !== "pending" || !canWrite ? null : (
          <>
            <div className={ADMIN_FORM_GRID}>
              <FormField label="Transfer outcome">{({ id }) => <Select id={id} value={state} options={[{ value: "paid", label: "Paid" }, { value: "failed", label: "Failed" }]} onChange={(event) => { setState(event.target.value === "failed" ? "failed" : "paid"); setReference("") }} />}</FormField>
              <FormField label={state === "paid" ? "Bank transfer reference" : "Failure code"} required>{({ id }) => <Input id={id} value={reference} maxLength={state === "paid" ? 200 : 80} onChange={(event) => { setReference(event.target.value) }} />}</FormField>
            </div>
            <Button disabled={update.isPending || reference.trim() === "" || (state === "failed" && !/^[A-Za-z0-9_.:-]{1,80}$/u.test(reference.trim()))} onClick={() => { setIsConfirming(true) }}>Record transfer outcome</Button>
          </>
        )}
      </div>
      <ConfirmDialog open={isConfirming} title={`Mark payout ${state}?`} description={state === "paid" ? "Confirm that the transfer has completed and the bank reference is correct." : "This records a failed transfer. The withdrawal stays in the investor's record and needs separate reconciliation."} confirmLabel="Confirm outcome" cancelLabel="Cancel" onConfirm={submit} onCancel={() => { setIsConfirming(false) }} />
    </Card>
  )
}
