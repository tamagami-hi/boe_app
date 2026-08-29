import { useParams } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { formatDateTime } from "~/domain/dates"
import { useAdminUserLoginEvents } from "~/features/admin/shared/adminQueries"
import { AdminTable } from "~/features/admin/shared/AdminTable"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { Badge } from "~/ui/primitives/Badge"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"

import { ADMIN_CODE } from "~/ui/recipes/admin"
import { META_TEXT } from "~/ui/recipes/text"

const OUTCOME_LABEL: Readonly<Record<string, string>> = {
  success: "Signed in",
  invalid_credentials: "Wrong password",
  unknown_identity: "No such account",
  account_not_active: "Account not active",
  password_changed: "Password had changed",
  not_authorized: "Not authorised",
}

const UserLoginEventsScreen = (): React.ReactElement => {
  const { userId = "" } = useParams()
  const query = useAdminUserLoginEvents(userId)

  return (
    <Page width="wide">
      <PageHeader
        title="Sign-in history"
        description="Every sign-in attempt recorded against this account, successful or not, newest first."
      />

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
            title="No sign-in attempts recorded"
            description="Nothing has tried to sign in as this account."
          />
        }
      >
        {(data) => (
          <AdminTable
            caption="Sign-in attempts"
            rows={data.items}
            rowKey={(row) => row.id}
            columns={[
              {
                key: "outcome",
                header: "Outcome",
                render: (row) => (
                  <Badge tone={row.succeeded ? "positive" : "negative"}>
                    {OUTCOME_LABEL[row.outcome] ?? row.outcome}
                  </Badge>
                ),
              },
              { key: "channel", header: "Channel", render: (row) => row.channel },
              { key: "email", header: "Email used", render: (row) => row.email },
              { key: "ip", header: "IP", render: (row) => row.ipAddress ?? "—" },
              {
                key: "agent",
                header: "Client",
                render: (row) => (
                  <span className={META_TEXT}>{row.userAgent ?? "not reported"}</span>
                ),
              },
              {
                key: "occurredAt",
                header: "When",
                render: (row) => formatDateTime(row.occurredAt),
              },
              {
                key: "requestId",
                header: "Request",
                render: (row) => <span className={ADMIN_CODE}>{row.requestId}</span>,
              },
            ]}
          />
        )}
      </AsyncBoundary>
    </Page>
  )
}

export default UserLoginEventsScreen
