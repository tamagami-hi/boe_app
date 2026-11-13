import { Link, useParams } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { useSession } from "~/app/providers/SessionProvider"
import { formatDateTime } from "~/domain/dates"
import { supportRequestState } from "~/domain/status"
import { AdminTable } from "~/features/admin/shared/AdminTable"
import { cx } from "~/lib/cx"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { LoadMore } from "~/ui/patterns/LoadMore"
import { StatusBadge } from "~/ui/patterns/StatusBadge"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"

import { ADMIN_CELL_LINK, ADMIN_CODE } from "~/ui/recipes/admin"
import { PROSE_PRE, PROSE_SM } from "~/ui/recipes/datalist"

import { SupportResponseForm } from "./SupportResponseForm"
import { categoryText, describeEvent } from "./supportPresentation"
import { useSupportTicket, useUserSupportTickets, type SupportTicketDetail } from "./supportQueries"

const MESSAGE_TEXT = cx(PROSE_SM, PROSE_PRE)

const TicketSummary = ({ ticket }: Readonly<{ ticket: SupportTicketDetail }>): React.ReactElement => {
  const { hasAnyPermission } = useSession()
  const canOpenUser = hasAnyPermission(["users.read", "users.read_limited"])
  return (
    <Section title="Request">
      <Card>
        <DataList split>
          <DetailRow label="Client" emphasis="lead">
            {canOpenUser ? (
              <Link to={`/users/${ticket.userId}`} className={ADMIN_CELL_LINK}>
                {ticket.clientName}
              </Link>
            ) : (
              ticket.clientName
            )}
          </DetailRow>
          <DetailRow label="Reference">
            <span className={ADMIN_CODE}>{ticket.reference}</span>
          </DetailRow>
          <DetailRow label="About">{categoryText(ticket.category)}</DetailRow>
          <DetailRow label="Status">
            <StatusBadge status={supportRequestState(ticket.status)} />
          </DetailRow>
          <DetailRow label="Raised">{formatDateTime(ticket.createdAt)}</DetailRow>
          {ticket.resolvedAt === null ? null : (
            <DetailRow label="Resolved">{formatDateTime(ticket.resolvedAt)}</DetailRow>
          )}
          {ticket.closedAt === null ? null : <DetailRow label="Closed">{formatDateTime(ticket.closedAt)}</DetailRow>}
        </DataList>
      </Card>
      <Card>
        <DataList>
          <DetailRow label="Subject">{ticket.subject}</DetailRow>
        </DataList>
        <p className={MESSAGE_TEXT}>{ticket.body}</p>
      </Card>
    </Section>
  )
}

const TicketHistory = ({ ticket }: Readonly<{ ticket: SupportTicketDetail }>): React.ReactElement => (
  <Section title="History" description="Every change to this request, oldest first. Entries are never edited.">
    <AdminTable
      caption="Request history"
      rows={ticket.history}
      rowKey={(row) => row.id}
      columns={[
        { key: "when", header: "When", render: (row) => formatDateTime(row.occurredAt) },
        { key: "event", header: "Change", render: (row) => describeEvent(row) },
        { key: "actor", header: "By", render: (row) => row.actorName ?? "System" },
      ]}
    />
  </Section>
)

const ClientRequests = ({ ticket }: Readonly<{ ticket: SupportTicketDetail }>): React.ReactElement => {
  const query = useUserSupportTickets(ticket.userId)
  return (
    <Section title="This client's requests" description="Newest first, including this one.">
      <AsyncBoundary
        query={query}
        skeleton={
          <Card>
            <Skeleton height="1rem" width="60%" />
          </Card>
        }
        isEmpty={(data) => data.items.length === 0}
        empty={<EmptyState title="No requests" description="This client has not raised any other request." />}
      >
        {(data) => (
          <AdminTable
            caption="This client's requests"
            rows={data.items}
            rowKey={(row) => row.id}
            columns={[
              {
                key: "request",
                header: "Request",
                render: (row) =>
                  row.id === ticket.id ? (
                    row.subject
                  ) : (
                    <Link to={`/support/${row.id}`} className={ADMIN_CELL_LINK}>
                      {row.subject}
                    </Link>
                  ),
              },
              { key: "reference", header: "Reference", render: (row) => <span className={ADMIN_CODE}>{row.reference}</span> },
              { key: "status", header: "Status", render: (row) => <StatusBadge status={supportRequestState(row.status)} /> },
              { key: "raised", header: "Raised", render: (row) => formatDateTime(row.createdAt) },
            ]}
          />
        )}
      </AsyncBoundary>
      <LoadMore list={query} noun="requests" />
    </Section>
  )
}

const SupportTicketScreen = (): React.ReactElement => {
  const { ticketId = "" } = useParams()
  const query = useSupportTicket(ticketId)
  const { hasAnyPermission } = useSession()
  const canReply = hasAnyPermission(["support.write"])
  const reload = async (): Promise<SupportTicketDetail | null> => {
    const result = await query.refetch()
    return result.isSuccess ? result.data : null
  }

  return (
    <Page width="wide">
      <PageHeader
        title="Support request"
        description="The client's message, what has happened since, and the reply they see in the app."
      />

      <AsyncBoundary
        query={query}
        skeleton={
          <Card>
            <Skeleton height="1.2rem" width="45%" />
            <Skeleton height="3rem" />
          </Card>
        }
      >
        {(ticket) => (
          <>
            <TicketSummary ticket={ticket} />
            <Section title="Reply" description="What the client sees under this request in the app now.">
              <Card>
                <p className={MESSAGE_TEXT}>{ticket.resolutionNote ?? "No reply yet."}</p>
              </Card>
              {canReply ? (
                <Card elevated>
                  <SupportResponseForm ticket={ticket} reloading={query.isFetching} onReload={reload} />
                </Card>
              ) : (
                <p className={PROSE_SM}>Your account can read support requests but cannot reply to them.</p>
              )}
            </Section>
            <TicketHistory ticket={ticket} />
            <ClientRequests ticket={ticket} />
          </>
        )}
      </AsyncBoundary>
    </Page>
  )
}

export default SupportTicketScreen
