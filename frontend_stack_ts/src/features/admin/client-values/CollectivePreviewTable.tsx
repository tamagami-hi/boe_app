import { useMemo } from "react"

import { hasCode } from "~/api/errors"
import { useSession } from "~/app/providers/SessionProvider"
import { toPaise } from "~/domain/money"
import { AdminTable, type AdminColumn } from "~/features/admin/shared/AdminTable"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Button } from "~/ui/primitives/Button"
import { Alert } from "~/ui/primitives/Feedback"

import { refKey } from "./investmentGrowthApi"
import type { InvestmentGrowthEntry } from "./investmentGrowthApi"
import { investorLabel, useInvestorDirectory } from "./investorQueries"

const NAME_PERMISSIONS = ["users.read", "users.read_limited"] as const

type Directory = ReturnType<typeof useInvestorDirectory>

type InvestorNames =
  | Readonly<{ kind: "loading" }>
  | Readonly<{ kind: "forbidden" }>
  | Readonly<{ kind: "failed" }>
  | Readonly<{ kind: "ready"; byUserId: ReadonlyMap<string, string>; isComplete: boolean }>

export type PreviewTarget = Readonly<{
  key: string
  userId: string
  investment: string
  principalPaise: string
  beforePaise: string
  deltaPaise: string
  afterPaise: string
}>

const targetsOf = (entries: readonly InvestmentGrowthEntry[]): PreviewTarget[] =>
  entries.flatMap((entry) =>
    entry.parts.map((part) => ({
      key: `${entry.userId}|${refKey(part.ref)}`,
      userId: entry.userId,
      investment: part.label,
      principalPaise: part.investedPaise,
      beforePaise: part.beforePaise,
      deltaPaise: part.deltaPaise,
      afterPaise: part.afterPaise,
    })),
  )

type DirectoryRead = Pick<Directory, "data" | "error" | "hasMore">

const investorNamesOf = (canReadNames: boolean, { data, error, hasMore }: DirectoryRead): InvestorNames => {
  if (!canReadNames || hasCode(error, "AUTHORIZATION_DENIED")) return { kind: "forbidden" }
  if (data !== undefined) {
    return {
      kind: "ready",
      byUserId: new Map(data.items.map((user) => [user.id, investorLabel(user)])),
      isComplete: !hasMore,
    }
  }
  return error == null ? { kind: "loading" } : { kind: "failed" }
}

const nameOf = (names: InvestorNames, userId: string): string => {
  if (names.kind !== "ready") return "Loading name"
  return names.byUserId.get(userId) ?? (names.isComplete ? "Not in the client list" : "Loading name")
}

const AMOUNT_COLUMNS: readonly AdminColumn<PreviewTarget>[] = [
  { key: "investment", header: "Investment", render: (row) => row.investment },
  {
    key: "principal",
    header: "Invested",
    numeric: true,
    render: (row) => <MoneyValue amount={toPaise(row.principalPaise)} size="sm" showDecimals />,
  },
  {
    key: "before",
    header: "Before",
    numeric: true,
    render: (row) => <MoneyValue amount={toPaise(row.beforePaise)} size="sm" showDecimals />,
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
    render: (row) => <MoneyValue amount={toPaise(row.afterPaise)} size="sm" showDecimals />,
  },
]

const columnsFor = (names: InvestorNames): readonly AdminColumn<PreviewTarget>[] => {
  if (names.kind === "forbidden" || names.kind === "failed") return AMOUNT_COLUMNS
  const investor: AdminColumn<PreviewTarget> = {
    key: "user",
    header: "Investor",
    render: (row) => nameOf(names, row.userId),
  }
  return [investor, ...AMOUNT_COLUMNS]
}

type NoticeProps = Readonly<{ names: InvestorNames; retrying: boolean; onRetry: () => void }>

const InvestorNamesNotice = ({ names, retrying, onRetry }: NoticeProps): React.ReactElement | null => {
  if (names.kind === "forbidden") {
    return (
      <Alert tone="info" title="Names not shown">
        Investor names are not available for this role. The amounts below are still the full preview.
      </Alert>
    )
  }
  if (names.kind !== "failed") return null
  return (
    <Alert
      tone="error"
      title="Names not loaded"
      action={
        <Button size="sm" tone="secondary" loading={retrying} onClick={onRetry}>
          Try again
        </Button>
      }
    >
      The client list could not be read, so the investors in this batch cannot be named. The amounts below are still
      the full preview.
    </Alert>
  )
}

export const CollectivePreviewTable = ({
  entries,
}: Readonly<{ entries: readonly InvestmentGrowthEntry[] }>): React.ReactElement => {
  const targets = useMemo(() => targetsOf(entries), [entries])
  const { hasAnyPermission } = useSession()
  const canReadNames = hasAnyPermission(NAME_PERMISSIONS)
  const directory = useInvestorDirectory(canReadNames)
  const { data, error, hasMore } = directory
  const names = useMemo(() => investorNamesOf(canReadNames, { data, error, hasMore }), [canReadNames, data, error, hasMore])

  return (
    <>
      <InvestorNamesNotice names={names} retrying={directory.isFetching} onRetry={directory.refetch} />
      <AdminTable
        caption="Preview, one row per investment"
        rows={targets}
        rowKey={(row) => row.key}
        columns={columnsFor(names)}
      />
    </>
  )
}
