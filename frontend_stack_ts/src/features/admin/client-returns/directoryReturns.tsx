import type { ReactNode } from "react"

import { isSessionEnded } from "~/api/errors"
import { useSession } from "~/app/providers/SessionProvider"
import { formatDateTime } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import type { AdminColumn } from "~/features/admin/shared/AdminTable"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Button } from "~/ui/primitives/Button"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"
import { META_MUTED, META_TEXT } from "~/ui/recipes/text"

import { useClientValueSummariesFor } from "./returnQueries"
import type { ClientValueSummary } from "./returnQueries"
import { ReturnValue } from "./ReturnValue"

type Row = Readonly<{ id: string }>

export type DirectoryReturns = Readonly<{
  columns: readonly AdminColumn<Row>[]
  notice: React.ReactElement | null
}>

export const useDirectoryReturns = (userIds: readonly string[]): DirectoryReturns => {
  const { hasAnyPermission } = useSession()
  const canRead = hasAnyPermission(["client_values.read"])
  const summaries = useClientValueSummariesFor(userIds, canRead)
  if (!canRead) return { columns: [], notice: null }

  const hasFailed = summaries.error !== null && !isSessionEnded(summaries.error)
  const cell = (row: Row, render: (summary: ClientValueSummary) => ReactNode): ReactNode => {
    const summary = summaries.byUserId.get(row.id)
    if (summary !== undefined) return render(summary)
    if (hasFailed) return <span className={META_MUTED}>Not loaded</span>
    if (summaries.isPending) return <Skeleton height="1rem" width="4rem" />
    return <span className={META_MUTED}>No recorded investment</span>
  }

  return {
    notice: hasFailed ? (
      <Alert
        tone="error"
        title="Returns not loaded"
        action={
          <Button tone="secondary" size="sm" onClick={summaries.refetch}>
            Try again
          </Button>
        }
      >
        Invested, value and return could not be read for these users. The account details below are current.
      </Alert>
    ) : null,
    columns: [
      {
        key: "invested",
        header: "Invested",
        numeric: true,
        render: (row) => cell(row, (summary) => <MoneyValue amount={toPaise(summary.investedPaise)} size="sm" showDecimals />),
      },
      {
        key: "value",
        header: "Value",
        numeric: true,
        render: (row) => cell(row, (summary) => <MoneyValue amount={toPaise(summary.currentValuePaise)} size="sm" showDecimals />),
      },
      {
        key: "return",
        header: "Return",
        numeric: true,
        render: (row) => cell(row, (summary) => <ReturnValue basisPoints={summary.simpleReturnBasisPoints} />),
      },
      {
        key: "value-updated",
        header: "Last updated",
        render: (row) =>
          cell(row, (summary) => (
            <span className={META_TEXT}>
              {summary.lastUpdatedAt === null ? "No entry" : formatDateTime(summary.lastUpdatedAt)}
            </span>
          )),
      },
    ],
  }
}
