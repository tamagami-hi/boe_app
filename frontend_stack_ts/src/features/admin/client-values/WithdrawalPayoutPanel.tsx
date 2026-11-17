import type { AdminWithdrawalPayout } from "@beonedge/contracts"
import { useState } from "react"

import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { formatDate } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { HeldWriteNotice, UnsavedHoldNotice, isUnsavedHold } from "~/features/admin/shared/HeldWriteNotice"
import { useHeldWrite } from "~/features/admin/shared/useHeldWrite"
import { useUnloadGuard } from "~/features/admin/shared/useUnloadGuard"
import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert } from "~/ui/primitives/Feedback"
import { FormField, Input } from "~/ui/primitives/FormField"
import { Select } from "~/ui/primitives/Select"
import { ADMIN_FORM_GRID } from "~/ui/recipes/admin"
import { STACK_LG } from "~/ui/recipes/layout"

import { parsePayoutUpdate } from "./heldBodies"
import { useUpdatePayout } from "./maturityQueries"

type Props = Readonly<{
  payout: Omit<AdminWithdrawalPayout, "maturityId">
  investorLabel: string
  fundName: string
  canWrite: boolean
  onReload: () => void
}>

type Outcome = "paid" | "failed"

const FAILURE_CODE_PATTERN = /^[A-Za-z0-9_.:-]{1,80}$/u

export const WithdrawalPayoutPanel = ({ payout, investorLabel, fundName, canWrite, onReload }: Props): React.ReactElement => {
  const write = useHeldWrite(useUpdatePayout(payout.userId), "The payout status could not be sent. Reload the page and try again.", {
    slot: `payout:${payout.id}`,
    parseBody: parsePayoutUpdate,
  })
  const held = write.held?.body ?? null
  const [state, setState] = useState<Outcome>(() => held?.state ?? "paid")
  const [reference, setReference] = useState(() =>
    held === null ? "" : held.state === "paid" ? held.transferReference : held.failureCode,
  )
  const [isConfirming, setIsConfirming] = useState(false)
  const locked = write.held !== null || write.pending || write.unreadable
  useUnloadGuard(isUnsavedHold(write))
  const trimmed = reference.trim()
  const isValid = trimmed !== "" && (state === "paid" || FAILURE_CODE_PATTERN.test(trimmed))

  const submit = (): void => {
    setIsConfirming(false)
    const expectedVersion = Number(payout.version)
    write.submit({
      payoutId: payout.id,
      body: state === "paid" ? { state, expectedVersion, transferReference: trimmed } : { state, expectedVersion, failureCode: trimmed },
    })
  }

  return (
    <Card>
      <div className={STACK_LG}>
        <p>
          {fundName} · {formatDate(payout.effectiveDate)} · {payout.state}
        </p>
        <MoneyValue amount={toPaise(payout.amountPaise)} size="sm" showDecimals />
        <p>{payout.transferReference ?? payout.failureCode ?? "Awaiting transfer confirmation"}</p>
        {payout.state === "failed" ? (
          <Alert tone="info" title="Transfer failed">
            The withdrawal remains recorded. Reconcile the transfer separately; this status does not restore the
            investor&apos;s balance.
          </Alert>
        ) : null}
        <HeldWriteNotice write={write} subject="the transfer outcome was recorded" reloadLabel="Reload the payouts" onReload={onReload} />
        <UnsavedHoldNotice write={write} />
        {write.outcome.kind === "done" ? (
          <Alert tone="success" title="Transfer outcome recorded">
            The payout status is updated.
          </Alert>
        ) : null}
        {(payout.state !== "pending" && write.held === null) || !canWrite ? null : (
          <>
            <div className={ADMIN_FORM_GRID}>
              <FormField label="Transfer outcome">
                {({ id }) => (
                  <Select
                    id={id}
                    value={state}
                    disabled={locked}
                    options={[
                      { value: "paid", label: "Paid" },
                      { value: "failed", label: "Failed" },
                    ]}
                    onChange={(event) => {
                      setState(event.target.value === "failed" ? "failed" : "paid")
                      setReference("")
                    }}
                  />
                )}
              </FormField>
              <FormField label={state === "paid" ? "Bank transfer reference" : "Failure code"} required>
                {({ id }) => (
                  <Input
                    id={id}
                    value={reference}
                    maxLength={state === "paid" ? 200 : 80}
                    disabled={locked}
                    onChange={(event) => {
                      setReference(event.target.value)
                    }}
                  />
                )}
              </FormField>
            </div>
            <Button
              disabled={locked || !isValid}
              loading={write.pending}
              onClick={() => {
                setIsConfirming(true)
              }}
            >
              Record transfer outcome
            </Button>
          </>
        )}
      </div>
      <ConfirmDialog
        open={isConfirming}
        title={`Mark payout ${state}?`}
        description={
          state === "paid"
            ? "Confirm that the transfer has completed and the bank reference is correct."
            : "This records a failed transfer. The withdrawal stays in the investor's record and needs separate reconciliation."
        }
        confirmLabel={state === "paid" ? "Mark paid" : "Mark failed"}
        cancelLabel="Cancel"
        onConfirm={submit}
        onCancel={() => {
          setIsConfirming(false)
        }}
      >
        <DataList>
          <DetailRow label="Investor">{investorLabel}</DetailRow>
          <DetailRow label="Fund">{fundName}</DetailRow>
          <DetailRow label="Withdrawal" emphasis="lead">
            <MoneyValue amount={toPaise(payout.amountPaise)} size="sm" showDecimals />
          </DetailRow>
          <DetailRow label="Withdrawal date">{formatDate(payout.effectiveDate)}</DetailRow>
          <DetailRow label="Outcome">{state === "paid" ? "Paid" : "Failed"}</DetailRow>
        </DataList>
      </ConfirmDialog>
    </Card>
  )
}
