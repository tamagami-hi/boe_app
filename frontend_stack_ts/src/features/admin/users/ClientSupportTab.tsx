import { Link } from "react-router-dom"

import { formatDateTime } from "~/domain/dates"
import { supportRequestState } from "~/domain/status"
import { AdminTable } from "~/features/admin/shared/AdminTable"
import { categoryText } from "~/features/admin/support/supportPresentation"
import { useUserSupportTickets } from "~/features/admin/support/supportQueries"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { LoadMore } from "~/ui/patterns/LoadMore"
import { StatusBadge } from "~/ui/patterns/StatusBadge"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"

import { ADMIN_CELL_LINK, ADMIN_CODE } from "~/ui/recipes/admin"
import { ENTRY_TEXT } from "~/ui/recipes/datalist"
import { META_TEXT } from "~/ui/recipes/text"

type Props = Readonly<{ userId: string }>

export const ClientSupportTab = ({ userId }: Props): React.ReactElement => {
  const query = useUserSupportTickets(userId)

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
            title="No support requests"
            description="This account has not raised a support request in the app."
          />
        }
      >
        {(data) => (
          <AdminTable
            caption="Support requests from this account"
            rows={data.items}
            rowKey={(row) => row.id}
            columns={[
              {
                key: "subject",
                header: "Request",
                render: (row) => (
                  <span className={ENTRY_TEXT}>
                    <Link to={`/support/${row.id}`} className={ADMIN_CELL_LINK}>
                      {row.subject}
                    </Link>
                    <span className={ADMIN_CODE}>{row.reference}</span>
                  </span>
                ),
              },
              {
                key: "category",
                header: "Category",
                render: (row) => <span className={META_TEXT}>{categoryText(row.category)}</span>,
              },
              {
                key: "status",
                header: "Status",
                render: (row) => <StatusBadge status={supportRequestState(row.status)} />,
              },
              { key: "raised", header: "Raised", render: (row) => formatDateTime(row.createdAt) },
            ]}
          />
        )}
      </AsyncBoundary>
      <LoadMore list={query} noun="requests" />
    </>
  )
}
