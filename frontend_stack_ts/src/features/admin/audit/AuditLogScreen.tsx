import { useState } from "react"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { formatDateTime } from "~/domain/dates"
import { useAdminAuditEvents } from "~/features/admin/shared/adminQueries"
import { AdminTable } from "~/features/admin/shared/AdminTable"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"
import { Input } from "~/ui/primitives/FormField"

import styles from "~/features/admin/shared/Admin.module.css"

const AuditLogScreen = (): React.ReactElement => {
  const [entityType, setEntityType] = useState("")
  const [command, setCommand] = useState("")
  const [applied, setApplied] = useState<Readonly<{ entityType: string; command: string }>>({
    entityType: "",
    command: "",
  })
  const query = useAdminAuditEvents(applied)

  const apply = (): void => {
    setApplied({ entityType: entityType.trim(), command: command.trim() })
  }

  return (
    <Page width="wide">
      <PageHeader
        title="Audit log"
        description="Every administrative command, who ran it, what it touched and which request it belonged to. Filtering runs on the server, so it covers the whole log."
      />

      <div className={styles.controls}>
        <Input
          type="search"
          placeholder="Entity type, for example content_item"
          aria-label="Filter by entity type"
          value={entityType}
          onChange={(event) => {
            setEntityType(event.target.value)
          }}
          onBlur={apply}
          onKeyDown={(event) => {
            if (event.key === "Enter") apply()
          }}
        />
        <Input
          type="search"
          placeholder="Command, for example user.suspended"
          aria-label="Filter by command"
          value={command}
          onChange={(event) => {
            setCommand(event.target.value)
          }}
          onBlur={apply}
          onKeyDown={(event) => {
            if (event.key === "Enter") apply()
          }}
        />
      </div>

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
            title="No audit entry matches"
            description="Clear the filters to see the whole log."
          />
        }
      >
        {(data) => (
          <AdminTable
            caption="Audit log"
            rows={data.items}
            rowKey={(row) => row.id}
            columns={[
              {
                key: "when",
                header: "When",
                render: (row) => formatDateTime(row.occurredAt),
              },
              {
                key: "actor",
                header: "Actor",
                render: (row) => (
                  <span className={styles.cellStack}>
                    <span>{row.actorEmail ?? row.actorType}</span>
                    <span className={styles.faint}>{row.actorType}</span>
                  </span>
                ),
              },
              { key: "command", header: "Command", render: (row) => row.command },
              {
                key: "entity",
                header: "Entity",
                render: (row) => (
                  <span className={styles.cellStack}>
                    <span>{row.entityType}</span>
                    <span className={styles.code}>{row.entityId}</span>
                  </span>
                ),
              },
              {
                key: "transition",
                header: "Transition",
                render: (row) =>
                  row.fromState === null && row.toState === null
                    ? "—"
                    : `${row.fromState ?? "—"} → ${row.toState ?? "—"}`,
              },
              {
                key: "version",
                header: "Version",
                numeric: true,
                render: (row) => String(row.entityVersion),
              },
              {
                key: "request",
                header: "Request",
                render: (row) => <span className={styles.code}>{row.requestId}</span>,
              },
            ]}
          />
        )}
      </AsyncBoundary>
    </Page>
  )
}

export default AuditLogScreen
