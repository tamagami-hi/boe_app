import { Link } from "react-router-dom"

import { formatDateTime } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { AdminTable, type AdminColumn } from "~/features/admin/shared/AdminTable"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { ADMIN_CELL_LINK, ADMIN_CODE } from "~/ui/recipes/admin"
import { ENTRY_TEXT } from "~/ui/recipes/datalist"
import { META_TEXT } from "~/ui/recipes/text"

import type { AuditTrailItem } from "./auditQueries"

type RecordLink = Readonly<{ to: string; label: string }>

const ORDER_ENTITIES: ReadonlySet<string> = new Set(["refund_operation", "fund_receipt_acknowledgement"])

const recordLinkOf = (row: AuditTrailItem): RecordLink | null => {
  if (row.entityType === "support_request") return { to: `/support/${row.entityId}`, label: "Support request" }
  if (row.client !== null && row.ledgerEntryId !== null) {
    return { to: `/users/${row.client.userId}?tab=ledger`, label: "Ledger entry" }
  }
  if (row.client !== null && row.entityType === "client_position_maturity") {
    return { to: `/users/${row.client.userId}?tab=maturity`, label: "Maturity" }
  }
  if (row.orderId !== null && ORDER_ENTITIES.has(row.entityType)) return { to: `/receipts/${row.orderId}`, label: "Order" }
  return null
}

const recordCell = (row: AuditTrailItem): React.ReactElement => {
  const link = recordLinkOf(row)
  return (
    <span className={ENTRY_TEXT}>
      {link === null ? <span>{row.entityType}</span> : (
        <Link to={link.to} className={ADMIN_CELL_LINK}>
          {link.label}
        </Link>
      )}
      <span className={ADMIN_CODE}>{row.ledgerEntryId ?? row.entityId}</span>
    </span>
  )
}

const BASE_COLUMNS: readonly AdminColumn<AuditTrailItem>[] = [
  { key: "when", header: "When", render: (row) => formatDateTime(row.occurredAt) },
  {
    key: "actor",
    header: "Actor",
    render: (row) => (
      <span className={ENTRY_TEXT}>
        <span>{row.actorEmail ?? row.actorType}</span>
        <span className={META_TEXT}>{row.actorType}</span>
      </span>
    ),
  },
  {
    key: "command",
    header: "Command",
    render: (row) => (
      <span className={ENTRY_TEXT}>
        <span>{row.command}</span>
        {row.fromState === null && row.toState === null ? null : (
          <span className={META_TEXT}>{`${row.fromState ?? "—"} → ${row.toState ?? "—"}`}</span>
        )}
      </span>
    ),
  },
]

const CLIENT_COLUMN: AdminColumn<AuditTrailItem> = {
  key: "client",
  header: "Client",
  render: (row) =>
    row.client === null ? (
      "—"
    ) : (
      <Link to={`/users/${row.client.userId}`} className={ADMIN_CELL_LINK}>
        {row.client.fullName}
      </Link>
    ),
}

const TAIL_COLUMNS: readonly AdminColumn<AuditTrailItem>[] = [
  {
    key: "amount",
    header: "Amount",
    numeric: true,
    render: (row) =>
      row.amountPaise === null ? "—" : <MoneyValue amount={toPaise(row.amountPaise)} size="sm" tone="signed" showDecimals showSign />,
  },
  { key: "record", header: "Record", render: recordCell },
  { key: "request", header: "Request", render: (row) => <span className={ADMIN_CODE}>{row.requestId}</span> },
]

type Props = Readonly<{ caption: string; rows: readonly AuditTrailItem[]; showClient: boolean }>

export const AuditTrailTable = ({ caption, rows, showClient }: Props): React.ReactElement => (
  <AdminTable
    caption={caption}
    rows={rows}
    rowKey={(row) => row.id}
    columns={[...BASE_COLUMNS, ...(showClient ? [CLIENT_COLUMN] : []), ...TAIL_COLUMNS]}
  />
)
