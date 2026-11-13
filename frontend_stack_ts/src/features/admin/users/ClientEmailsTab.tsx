import { formatDateTime } from "~/domain/dates"
import { emailDeliveryState } from "~/domain/status"
import { useClientEmailDeliveries } from "~/features/admin/client-returns/returnQueries"
import { AdminTable } from "~/features/admin/shared/AdminTable"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { LoadMore } from "~/ui/patterns/LoadMore"
import { StatusBadge } from "~/ui/patterns/StatusBadge"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"

type Props = Readonly<{ userId: string }>

export const ClientEmailsTab = ({ userId }: Props): React.ReactElement => {
  const query = useClientEmailDeliveries(userId)

  return (
    <>
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
            title="No email to this account"
            description="No invite, notice or admin message has been queued for this user."
          />
        }
      >
        {(data) => (
          <AdminTable
            caption="Emails to this account"
            rows={data.items}
            rowKey={(row) => row.emailDeliveryId}
            columns={[
              { key: "template", header: "Template", render: (row) => row.templateKey },
              { key: "recipient", header: "Recipient", render: (row) => row.recipientMasked },
              {
                key: "state",
                header: "State",
                render: (row) => <StatusBadge status={emailDeliveryState(row.state)} />,
              },
              {
                key: "attempts",
                header: "Attempts",
                numeric: true,
                render: (row) => String(row.attemptCount),
              },
              { key: "error", header: "Last error", render: (row) => row.lastErrorCode ?? "—" },
              { key: "created", header: "Queued", render: (row) => formatDateTime(row.createdAt) },
            ]}
          />
        )}
      </AsyncBoundary>
      <LoadMore list={query} noun="emails" />
    </>
  )
}
