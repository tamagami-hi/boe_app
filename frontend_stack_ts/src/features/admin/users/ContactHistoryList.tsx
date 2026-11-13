import { formatDateTime } from "~/domain/dates"
import { AdminTable } from "~/features/admin/shared/AdminTable"
import { EmptyState } from "~/ui/patterns/EmptyState"

import { ENTRY_TEXT } from "~/ui/recipes/datalist"
import { META_TEXT } from "~/ui/recipes/text"

import type { ContactHistoryEntry } from "./contactQueries"

const KIND_LABEL = {
  admin_correction: "Corrected before a password was set",
  closed_release: "Released from the closed account",
} as const

const change = (previous: string, next: string): React.ReactElement =>
  previous === next ? (
    <span className={META_TEXT}>Unchanged</span>
  ) : (
    <span className={ENTRY_TEXT}>
      <span>{next}</span>
      <span className={META_TEXT}>{`was ${previous}`}</span>
    </span>
  )

export const ContactHistoryList = ({
  entries,
}: Readonly<{ entries: readonly ContactHistoryEntry[] }>): React.ReactElement =>
  entries.length === 0 ? (
    <EmptyState
      title="No contact changes"
      description="Corrections and releases of this account's email and phone appear here, with the originals."
    />
  ) : (
    <AdminTable
      caption="Contact history"
      rows={entries}
      rowKey={(row) => row.id}
      columns={[
        { key: "when", header: "When", render: (row) => formatDateTime(row.createdAt) },
        { key: "kind", header: "Change", render: (row) => KIND_LABEL[row.kind] },
        { key: "email", header: "Email", render: (row) => change(row.previousEmail, row.newEmail) },
        { key: "phone", header: "Phone", render: (row) => change(row.previousPhone, row.newPhone) },
        { key: "actor", header: "By", render: (row) => row.actorName ?? row.actorUserId },
        { key: "reason", header: "Reason", render: (row) => row.reason ?? "—" },
      ]}
    />
  )
