import { useState } from "react"

import { isApiError } from "~/api/errors"
import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { useSession } from "~/app/providers/SessionProvider"
import { formatDateTime } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { refundState } from "~/domain/status"
import { useAdminRefunds, useRefundAction } from "~/features/admin/shared/adminQueries"
import type { RefundAction, RefundFilter } from "~/features/admin/shared/adminQueries"
import { AdminTable, FilterChip, FilterRow } from "~/features/admin/shared/AdminTable"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { StatusBadge } from "~/ui/patterns/StatusBadge"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"

import { ADMIN_CODE } from "~/ui/recipes/admin"
import { ENTRY_TEXT } from "~/ui/recipes/datalist"
import { ACTION_ROW } from "~/ui/recipes/layout"
import { META_TEXT } from "~/ui/recipes/text"

const FILTERS = [
  { value: "failed", label: "Failed" },
  { value: "pending", label: "Queued" },
  { value: "provider_pending", label: "With provider" },
  { value: "refunded", label: "Refunded" },
  { value: "all", label: "All" },
] as const

type Confirming = Readonly<{ refundId: string; action: RefundAction }> | null

const COPY: Readonly<Record<RefundAction, Readonly<{ title: string; description: string }>>> = {
  retry: {
    title: "Queue this refund again?",
    description:
      "The refund goes back to the worker to be sent to PhonePe. It does not refund the money by itself, and it does not create a second refund.",
  },
  reconcile: {
    title: "Ask PhonePe what happened?",
    description:
      "We ask the provider for this refund's real state and record what it says. If PhonePe says it failed, the refund is marked failed rather than guessed at.",
  },
}

const RefundQueueScreen = (): React.ReactElement => {
  const [filter, setFilter] = useState<RefundFilter>("failed")
  const query = useAdminRefunds(filter)
  const action = useRefundAction()
  const { hasAnyPermission } = useSession()
  const [confirming, setConfirming] = useState<Confirming>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const canWrite = hasAnyPermission(["refunds.write"])

  const run = (target: NonNullable<Confirming>): void => {
    setFailure(null)
    action.mutate(target, {
      onError: (error) => {
        setFailure(
          isApiError(error)
            ? error.code === "DEPENDENCY_UNAVAILABLE"
              ? "PhonePe is not reachable from this environment, so the refund cannot be reconciled here."
              : error.message
            : "We could not do that. Nothing has changed.",
        )
      },
      onSettled: () => {
        setConfirming(null)
      },
    })
  }

  return (
    <Page width="wide">
      <PageHeader
        title="Refunds"
        description="A refund that failed does not retry itself. Nothing on this screen moves money directly; it asks the worker or the provider to act."
      />

      <FilterRow label="Refund state">
        {FILTERS.map((option) => (
          <FilterChip
            key={option.value}
            active={option.value === filter}
            label={option.label}
            onSelect={() => {
              setFilter(option.value)
            }}
          />
        ))}
      </FilterRow>

      {failure === null ? null : (
        <Alert tone="error" title="Nothing changed">
          {failure}
        </Alert>
      )}

      <AsyncBoundary
        query={query}
        skeleton={
          <Card>
            <Skeleton height="1rem" width="45%" />
            <Skeleton height="1rem" width="70%" />
          </Card>
        }
        isEmpty={(data) => data.items.length === 0}
        empty={
          <EmptyState
            title="No refund in that state"
            description="Nothing needs a decision here right now."
          />
        }
      >
        {(data) => (
          <AdminTable
            caption="Refunds"
            rows={data.items}
            rowKey={(row) => row.id}
            columns={[
              {
                key: "client",
                header: "Investor",
                render: (row) => (
                  <span className={ENTRY_TEXT}>
                    <span>{row.client.name}</span>
                    <span className={META_TEXT}>{row.client.email}</span>
                  </span>
                ),
              },
              {
                key: "amount",
                header: "Amount",
                numeric: true,
                render: (row) => <MoneyValue amount={toPaise(row.amountPaise)} size="sm" />,
              },
              {
                key: "state",
                header: "State",
                render: (row) => <StatusBadge status={refundState(row.state)} />,
              },
              {
                key: "attempts",
                header: "Attempts",
                numeric: true,
                render: (row) => String(row.attemptCount),
              },
              {
                key: "failure",
                header: "Reported reason",
                render: (row) => row.failureCode ?? "—",
              },
              {
                key: "reference",
                header: "Merchant refund",
                render: (row) => <span className={ADMIN_CODE}>{row.merchantRefundId}</span>,
              },
              {
                key: "updated",
                header: "Updated",
                render: (row) => formatDateTime(row.updatedAt),
              },
              {
                key: "actions",
                header: "Actions",
                render: (row) =>
                  canWrite ? (
                    <span className={ACTION_ROW}>
                      {row.state === "failed" ? (
                        <Button
                          tone="secondary"
                          size="sm"
                          disabled={action.isPending}
                          onClick={() => {
                            setConfirming({ refundId: row.id, action: "retry" })
                          }}
                        >
                          Queue again
                        </Button>
                      ) : null}
                      <Button
                        tone="ghost"
                        size="sm"
                        disabled={action.isPending}
                        onClick={() => {
                          setConfirming({ refundId: row.id, action: "reconcile" })
                        }}
                      >
                        Ask provider
                      </Button>
                    </span>
                  ) : (
                    <span className={META_TEXT}>Read only</span>
                  ),
              },
            ]}
          />
        )}
      </AsyncBoundary>

      {confirming === null ? null : (
        <ConfirmDialog
          open
          title={COPY[confirming.action].title}
          description={COPY[confirming.action].description}
          confirmLabel={confirming.action === "retry" ? "Queue it again" : "Ask PhonePe"}
          pending={action.isPending}
          onConfirm={() => {
            run(confirming)
          }}
          onCancel={() => {
            setConfirming(null)
          }}
        />
      )}
    </Page>
  )
}

export default RefundQueueScreen
