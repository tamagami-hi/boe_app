import { useState } from "react"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { formatDateTime } from "~/domain/dates"
import { NOMINEE_REQUEST_STATE_OPTIONS, nomineeRequestState, type NomineeRequestState } from "~/domain/nomineeRequests"
import { AdminTable, FilterChip, FilterRow } from "~/features/admin/shared/AdminTable"
import { ClientPageLink } from "~/features/admin/shared/clientPageLink"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { LoadMore } from "~/ui/patterns/LoadMore"
import { StatusBadge } from "~/ui/patterns/StatusBadge"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"
import { META_TEXT } from "~/ui/recipes/text"

import { useNomineeRequestQueue } from "./nomineeRequestQueries"

type StateFilter = NomineeRequestState | "any"

const STATE_FILTERS: readonly Readonly<{ value: StateFilter; label: string }>[] = [
  { value: "any", label: "All, waiting first" },
  ...NOMINEE_REQUEST_STATE_OPTIONS,
]

const emptyCopy = (state: StateFilter): string =>
  state === "any" || state === "pending" ? "No client is waiting for a nominee decision." : "Choose another filter."

const NomineeRequestQueueScreen = (): React.ReactElement => {
  const [state, setState] = useState<StateFilter>("any")
  const query = useNomineeRequestQueue(state === "any" ? null : state)

  return (
    <Page width="wide">
      <PageHeader
        title="Nominee requests"
        description="Requests clients send from their profile to add or change their nominee, waiting ones first and then newest first. Open a client to accept or decline; accepting sets the nominee on the account, and the client is told either way in the app and by email."
      />

      <FilterRow label="Request state">
        {STATE_FILTERS.map((option) => (
          <FilterChip
            key={option.value}
            active={option.value === state}
            label={option.label}
            onSelect={() => {
              setState(option.value)
            }}
          />
        ))}
      </FilterRow>

      <AsyncBoundary
        query={query}
        skeleton={
          <Card>
            <Skeleton height="1rem" width="45%" />
            <Skeleton height="1rem" width="70%" />
          </Card>
        }
        isEmpty={(data) => data.items.length === 0}
        empty={<EmptyState title="No nominee requests here" description={emptyCopy(state)} />}
      >
        {(data) => (
          <AdminTable
            caption="Nominee requests"
            rows={data.items}
            rowKey={(row) => row.id}
            columns={[
              {
                key: "client",
                header: "Client",
                render: (row) => <ClientPageLink userId={row.userId}>{row.clientName}</ClientPageLink>,
              },
              { key: "nominee", header: "Requested nominee", render: (row) => row.nominee.name },
              { key: "relation", header: "Relation", render: (row) => row.nominee.relation },
              { key: "state", header: "State", render: (row) => <StatusBadge status={nomineeRequestState(row.state)} /> },
              { key: "sent", header: "Sent", render: (row) => formatDateTime(row.createdAt) },
              {
                key: "closed",
                header: "Closed",
                render: (row) =>
                  row.decidedAt === null ? (
                    <span className={META_TEXT}>Still open</span>
                  ) : (
                    <span className={META_TEXT}>
                      {`${formatDateTime(row.decidedAt)}${row.decidedByName === null ? "" : ` by ${row.decidedByName}`}`}
                    </span>
                  ),
              },
            ]}
          />
        )}
      </AsyncBoundary>
      <LoadMore list={query} noun="requests" />
    </Page>
  )
}

export default NomineeRequestQueueScreen
