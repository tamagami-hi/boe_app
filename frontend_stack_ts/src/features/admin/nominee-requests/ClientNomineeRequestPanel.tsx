import { useState } from "react"

import { useSession } from "~/app/providers/SessionProvider"
import { formatDateTime } from "~/domain/dates"
import { nomineeRequestState } from "~/domain/nomineeRequests"
import { AdminTable } from "~/features/admin/shared/AdminTable"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { LoadMore } from "~/ui/patterns/LoadMore"
import { StatusBadge } from "~/ui/patterns/StatusBadge"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"
import { ITEM_TITLE, PROSE_SM } from "~/ui/recipes/datalist"
import { STACK_LG } from "~/ui/recipes/layout"
import { META_TEXT } from "~/ui/recipes/text"

import { NomineeDecisionForm } from "./NomineeDecisionForm"
import { useUserNomineeRequests, type NomineeDecision } from "./nomineeRequestQueries"

const decidedCopy = (decision: NomineeDecision): Readonly<{ title: string; body: string }> =>
  decision.request.state === "accepted"
    ? {
        title: "Request accepted",
        body: `The nominee is now ${decision.request.nominee.name} (${decision.request.nominee.relation}). The client is told in the app and by email.`,
      }
    : {
        title: "Request declined",
        body: "The nominee did not change. The client is told in the app and by email, with your reason if you gave one.",
      }

type Props = Readonly<{
  userId: string
  nomineeVersion: number
  accountState: string
}>

export const ClientNomineeRequestPanel = ({ userId, nomineeVersion, accountState }: Props): React.ReactElement => {
  const query = useUserNomineeRequests(userId)
  const { hasAnyPermission } = useSession()
  const canDecide = hasAnyPermission(["clients.create"])
  const [decided, setDecided] = useState<NomineeDecision | null>(null)


  return (
    <div className={STACK_LG}>
      <h3 className={ITEM_TITLE}>Nominee requests from the client</h3>
      {decided === null ? null : (
        <Alert tone={decided.request.state === "accepted" ? "success" : "info"} title={decidedCopy(decided).title}>
          {decidedCopy(decided).body}
        </Alert>
      )}
      <AsyncBoundary query={query} skeleton={<Skeleton height="4rem" />}>
        {(data) => {
          const pending = data.items.find((item) => item.state === "pending")
          const closed = data.items.filter((item) => item.state !== "pending")
          return (
            <>
              {pending === undefined ? (
                <p className={PROSE_SM}>No request is waiting for a decision.</p>
              ) : canDecide ? (
                <NomineeDecisionForm
                  key={`${pending.id}:${String(pending.version)}`}
                  userId={userId}
                  request={pending}
                  nomineeVersion={nomineeVersion}
                  canAccept={accountState !== "closed"}
                  reloading={query.isFetching}
                  onReload={query.refetch}
                  onDecided={setDecided}
                />
              ) : (
                <p className={PROSE_SM}>
                  {`${pending.nominee.name} (${pending.nominee.relation}) is waiting for a decision. Deciding needs the clients.create permission.`}
                </p>
              )}
              {closed.length === 0 ? null : (
                <AdminTable
                  caption="Earlier nominee requests"
                  rows={closed}
                  rowKey={(row) => row.id}
                  columns={[
                    { key: "nominee", header: "Requested nominee", render: (row) => `${row.nominee.name} (${row.nominee.relation})` },
                    { key: "state", header: "State", render: (row) => <StatusBadge status={nomineeRequestState(row.state)} /> },
                    { key: "sent", header: "Sent", render: (row) => formatDateTime(row.createdAt) },
                    {
                      key: "closed",
                      header: "Closed",
                      render: (row) =>
                        row.decidedAt === null
                          ? null
                          : `${formatDateTime(row.decidedAt)}${row.decidedByName === null ? "" : ` by ${row.decidedByName}`}`,
                    },
                    {
                      key: "reason",
                      header: "Decline reason",
                      render: (row) => <span className={META_TEXT}>{row.declineReason ?? ""}</span>,
                    },
                  ]}
                />
              )}
            </>
          )
        }}
      </AsyncBoundary>
      <LoadMore list={query} noun="requests" />
    </div>
  )
}
