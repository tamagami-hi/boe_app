import type { AdminInvestorPositionsData } from "@beonedge/contracts"
import { useEffect, useState } from "react"

import { Section } from "~/app/layouts/Section"
import { formatDate, indiaToday } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { AdminTable } from "~/features/admin/shared/AdminTable"
import { useFundNames } from "~/features/admin/shared/fundNames"
import { HeldWriteNotice, UnsavedHoldNotice, isUnsavedHold } from "~/features/admin/shared/HeldWriteNotice"
import { useHeldWrite } from "~/features/admin/shared/useHeldWrite"
import { useUnloadGuard } from "~/features/admin/shared/useUnloadGuard"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { AmountInput } from "~/ui/primitives/AmountInput"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert } from "~/ui/primitives/Feedback"
import { FormField, Input } from "~/ui/primitives/FormField"
import { Select } from "~/ui/primitives/Select"
import { ADMIN_FORM_GRID } from "~/ui/recipes/admin"
import { PROSE_SM } from "~/ui/recipes/datalist"
import { STACK_LG } from "~/ui/recipes/layout"

import { ListSkeleton } from "./ListSkeleton"
import { MaturityPanelConfirm, type MaturityAsk } from "./MaturityPanelConfirm"
import { parseMarkMaturity, parseSettlement } from "./heldBodies"
import { useMarkMaturity, useMaturityRecords, useSettleMaturity, useWithdrawalPayouts } from "./maturityQueries"
import { useReloadPayoutOutcomes } from "./payoutOutcomeQueries"
import { paiseToRupeeText, parsePositiveRupees } from "./rupeeAmount"
import { WithdrawalPayoutPanel } from "./WithdrawalPayoutPanel"

type Position = AdminInvestorPositionsData["items"][number]

type Props = Readonly<{
  userId: string
  investorLabel: string
  canWrite: boolean
  positions: readonly Position[]
  onUnsavedHold?: (unsaved: boolean) => void
}>

const SETTLED_TEXT = {
  withdrawal: "Withdrawal recorded. Confirm the bank transfer outcome below when available.",
  reinvestment: "Reinvestment recorded. The current value is now the new invested amount.",
} as const

const noteOf = (text: string): Readonly<{ note?: string }> => (text.trim() === "" ? {} : { note: text.trim() })

export const MaturityPanel = ({ userId, investorLabel, canWrite, positions, onUnsavedHold }: Props): React.ReactElement => {
  const funds = useFundNames()
  const maturities = useMaturityRecords(userId)
  const payouts = useWithdrawalPayouts(userId)
  const reloadOutcomes = useReloadPayoutOutcomes(userId)
  const mark = useHeldWrite(useMarkMaturity(userId), "The maturity could not be sent. Reload the page and try again.", {
    slot: `maturity-mark:${userId}`,
    parseBody: parseMarkMaturity,
  })
  const settle = useHeldWrite(useSettleMaturity(userId), "The settlement could not be sent. Reload the page and try again.", {
    slot: `maturity-settle:${userId}`,
    parseBody: parseSettlement,
  })
  const today = indiaToday()
  const [fundId, setFundId] = useState(() => mark.held?.fundId ?? settle.held?.body.fundId ?? "")
  const [date, setDate] = useState(() => mark.held?.maturedOn ?? settle.held?.body.effectiveDate ?? today)
  const [withdrawalRupees, setWithdrawalRupees] = useState(() =>
    settle.held?.kind === "withdrawal" ? paiseToRupeeText(settle.held.body.amountPaise) : "",
  )
  const [note, setNote] = useState(() => mark.held?.note ?? settle.held?.body.note ?? "")
  const [asking, setAsking] = useState<MaturityAsk | null>(null)
  const [settledKind, setSettledKind] = useState(() => settle.held?.kind ?? null)

  const unsaved = isUnsavedHold(mark) || isUnsavedHold(settle)
  useUnloadGuard(unsaved)
  useEffect(() => {
    onUnsavedHold?.(unsaved)
    return () => {
      onUnsavedHold?.(false)
    }
  }, [unsaved, onUnsavedHold])

  const items = maturities.data?.items ?? []
  const pending = items.find((row) => row.fundId === fundId && row.state === "pending")
  const position = positions.find((row) => row.fundId === fundId)
  const locked =
    !canWrite ||
    mark.held !== null ||
    settle.held !== null ||
    mark.pending ||
    settle.pending ||
    mark.unreadable ||
    settle.unreadable
  const isReady = !locked && maturities.data !== undefined && funds.ready && fundId !== "" && date !== "" && date <= today
  const withdrawalPaise = parsePositiveRupees(withdrawalRupees)
  const isAmountValid =
    withdrawalPaise !== null && position !== undefined && BigInt(withdrawalPaise) <= BigInt(position.currentValuePaise)
  const isEmptyPosition =
    position === undefined || (BigInt(position.currentValuePaise) <= 0n && BigInt(position.principalPaise) <= 0n)

  const reload = (): void => {
    void maturities.refetch()
    void payouts.refetch()
    reloadOutcomes()
  }

  const changeFund = (next: string): void => {
    setFundId(next)
    setWithdrawalRupees("")
    if (!mark.unreadable) mark.reset()
    if (!settle.unreadable) settle.reset()
  }

  const confirm = (): void => {
    const kind = asking
    setAsking(null)
    if (kind === "mark") {
      mark.submit({ fundId, maturedOn: date, reasonCode: "position_matured", ...noteOf(note) })
      return
    }
    if (kind === null || pending === undefined) return
    const body = {
      fundId,
      effectiveDate: date,
      reasonCode: kind === "withdrawal" ? "maturity_withdrawal" : "maturity_reinvestment",
      ...noteOf(note),
    }
    setSettledKind(kind)
    if (kind === "reinvestment") {
      settle.submit({ kind, maturityId: pending.id, body })
      return
    }
    if (withdrawalPaise !== null) settle.submit({ kind, maturityId: pending.id, body: { ...body, amountPaise: withdrawalPaise } })
  }

  return (
    <Section
      title="Maturity and settlement"
      description="Mark a position as matured, then withdraw an amount or reinvest its full current value. Withdrawals use positive growth first."
    >
      <div className={STACK_LG}>
        <HeldWriteNotice write={mark} subject="the position was marked matured" reloadLabel="Reload the maturity history" onReload={reload} />
        <HeldWriteNotice write={settle} subject="the settlement was recorded" reloadLabel="Reload the maturity history" onReload={reload} />
        <UnsavedHoldNotice write={mark} />
        <UnsavedHoldNotice write={settle} />
        {mark.outcome.kind === "done" ? (
          <Alert tone="success" title="Saved">
            Position marked as matured. Choose withdrawal or reinvestment to settle it.
          </Alert>
        ) : null}
        {settle.outcome.kind === "done" && settledKind !== null ? (
          <Alert tone="success" title="Saved">
            {SETTLED_TEXT[settledKind]}
          </Alert>
        ) : null}
        <Card elevated>
          <div className={STACK_LG}>
            <div className={ADMIN_FORM_GRID}>
              <FormField label="Position" required>
                {({ id }) => (
                  <Select
                    id={id}
                    value={fundId}
                    disabled={locked || !funds.ready}
                    options={[
                      { value: "", label: "Choose a fund position" },
                      ...positions.map((row) => ({ value: row.fundId, label: funds.nameOf(row.fundId) })),
                    ]}
                    onChange={(event) => {
                      changeFund(event.target.value)
                    }}
                  />
                )}
              </FormField>
              <FormField label={pending === undefined ? "Maturity date" : "Settlement date"} required>
                {({ id }) => (
                  <Input
                    id={id}
                    type="date"
                    value={date}
                    max={today}
                    min={pending?.maturedOn}
                    disabled={locked}
                    onChange={(event) => {
                      setDate(event.target.value)
                    }}
                  />
                )}
              </FormField>
            </div>
            {position === undefined ? null : (
              <p>
                Current value: <MoneyValue amount={toPaise(position.currentValuePaise)} size="sm" showDecimals />
              </p>
            )}
            <FormField label="Note" hint="Optional context for the record.">
              {({ id }) => (
                <Input
                  id={id}
                  value={note}
                  maxLength={2000}
                  disabled={locked}
                  onChange={(event) => {
                    setNote(event.target.value)
                  }}
                />
              )}
            </FormField>
            {maturities.data === undefined ? (
              <p className={PROSE_SM}>Maturity actions open once the maturity history below has loaded.</p>
            ) : null}
            {pending === undefined ? (
              <Button
                disabled={!isReady || isEmptyPosition}
                onClick={() => {
                  setAsking("mark")
                }}
              >
                Mark matured
              </Button>
            ) : (
              <>
                <p>Matured on {formatDate(pending.maturedOn)}. A settlement uses the position&apos;s current value.</p>
                <FormField
                  label="Withdrawal amount in rupees"
                  hint="A positive amount up to the current value, with at most two decimal places."
                >
                  {({ id, describedBy }) => (
                    <AmountInput
                      id={id}
                      value={withdrawalRupees}
                      decimals
                      disabled={locked}
                      describedBy={describedBy}
                      onChange={setWithdrawalRupees}
                    />
                  )}
                </FormField>
                <Button
                  disabled={!isReady || !isAmountValid || date < pending.maturedOn}
                  onClick={() => {
                    setAsking("withdrawal")
                  }}
                >
                  Record withdrawal
                </Button>
                <Button
                  disabled={
                    !isReady ||
                    position === undefined ||
                    position.currentValuePaise === position.principalPaise ||
                    date < pending.maturedOn
                  }
                  onClick={() => {
                    setAsking("reinvestment")
                  }}
                >
                  Reinvest full position
                </Button>
              </>
            )}
          </div>
        </Card>
        <AsyncBoundary
          query={maturities}
          skeleton={<ListSkeleton />}
          isEmpty={(data) => data.items.length === 0}
          empty={<EmptyState title="No maturity recorded" description="No position of this investor has been marked as matured." />}
        >
          {(data) => (
            <AdminTable
              caption="Maturity history (latest 100)"
              rows={data.items}
              rowKey={(row) => row.id}
              columns={[
                { key: "fund", header: "Fund", render: (row) => funds.nameOf(row.fundId) },
                { key: "date", header: "Matured", render: (row) => formatDate(row.maturedOn) },
                {
                  key: "value",
                  header: "Value at maturity",
                  render: (row) => <MoneyValue amount={toPaise(row.valueAtMaturityPaise)} size="sm" showDecimals />,
                },
                { key: "state", header: "Status", render: (row) => row.settlement ?? row.state },
              ]}
            />
          )}
        </AsyncBoundary>
        <p>
          Withdrawal payouts (latest 100). Recording a withdrawal does not execute a bank transfer. Reversing a ledger
          entry does not mean transferred money has returned.
        </p>
        <AsyncBoundary
          query={payouts}
          skeleton={<ListSkeleton />}
          isEmpty={(data) => data.items.length === 0}
          empty={<EmptyState title="No withdrawal payout" description="No withdrawal has been recorded for this investor." />}
        >
          {(data) =>
            data.items.map((payout) => (
              <WithdrawalPayoutPanel
                key={payout.id}
                payout={payout}
                investorLabel={investorLabel}
                fundName={funds.nameOf(payout.fundId)}
                canWrite={canWrite}
                onReload={reload}
              />
            ))
          }
        </AsyncBoundary>
      </div>
      <MaturityPanelConfirm
        asking={asking}
        investorLabel={investorLabel}
        fundName={funds.nameOf(fundId)}
        date={date}
        position={position}
        withdrawalPaise={withdrawalPaise}
        onConfirm={confirm}
        onCancel={() => {
          setAsking(null)
        }}
      />
    </Section>
  )
}
