import { Section } from "~/app/layouts/Section"
import { formatDate } from "~/domain/dates"
import { assertNever } from "~/lib/assertNever"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { Card } from "~/ui/primitives/Card"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"
import { ITEM_TITLE, PROSE_SM } from "~/ui/recipes/datalist"

import { NomineeRequestForm } from "./NomineeRequestForm"
import { useClientNominee, useLatestNomineeRequest, type ClientNominee, type NomineeRequest } from "./nomineeQueries"
import { PendingNomineeRequest } from "./PendingNomineeRequest"

const requestedText = (request: NomineeRequest): string =>
  `${request.nominee.name} (${request.nominee.relation})`

const decidedOn = (request: NomineeRequest): string =>
  request.decidedAt === null ? "" : ` on ${formatDate(request.decidedAt)}`

const LastRequest = ({ request }: Readonly<{ request: NomineeRequest }>): React.ReactElement | null => {
  switch (request.state) {
    case "accepted":
      return (
        <Alert tone="success" title="Request accepted">
          {`The BeOnEdge team accepted your request to name ${requestedText(request)}${decidedOn(request)}.`}
        </Alert>
      )
    case "declined":
      return (
        <Alert tone="warning" title="Request declined">
          {`The BeOnEdge team declined your request to name ${requestedText(request)}${decidedOn(request)}, so your nominee did not change. ${
            request.declineReason === null ? "No reason was given." : `Reason: ${request.declineReason}`
          }`}
        </Alert>
      )
    case "withdrawn":
      return <p className={PROSE_SM}>{`You withdrew your request to name ${requestedText(request)}${decidedOn(request)}.`}</p>
    case "pending":
      return null
    default:
      return assertNever(request.state)
  }
}

type RequestAreaProps = Readonly<{ current: ClientNominee["nominee"] }>

const NomineeRequestArea = ({ current }: RequestAreaProps): React.ReactElement => {
  const latest = useLatestNomineeRequest()
  const reload = (): void => {
    void latest.refetch()
  }

  return (
    <AsyncBoundary query={latest} skeleton={<Skeleton height="8rem" />}>
      {({ request }) =>
        request?.state === "pending" ? (
          <>
            <h3 className={ITEM_TITLE}>Your request</h3>
            <PendingNomineeRequest request={request} reloading={latest.isFetching} onReload={reload} />
          </>
        ) : (
          <>
            <h3 className={ITEM_TITLE}>{current === null ? "Request a nominee" : "Request a change"}</h3>
            {request === null ? null : <LastRequest request={request} />}
            <NomineeRequestForm current={current} reloading={latest.isFetching} onReload={reload} />
          </>
        )
      }
    </AsyncBoundary>
  )
}

export const NomineeSection = (): React.ReactElement => {
  const nominee = useClientNominee()

  return (
    <Section
      title="Nominee"
      description="The person you nominate on your BeOnEdge account, and their relation to you. To add or change them, send a request confirmed with your current password. The BeOnEdge team reviews it and tells you in the app and by email."
    >
      <AsyncBoundary query={nominee} skeleton={<Skeleton height="6rem" />}>
        {(data) => (
          <Card elevated>
            {data.nominee === null ? (
              <p className={PROSE_SM}>No nominee is recorded on your account yet.</p>
            ) : (
              <DataList split>
                <DetailRow label="Nominee">{data.nominee.name}</DetailRow>
                <DetailRow label="Relation">{data.nominee.relation}</DetailRow>
              </DataList>
            )}
            <NomineeRequestArea current={data.nominee} />
          </Card>
        )}
      </AsyncBoundary>
    </Section>
  )
}
