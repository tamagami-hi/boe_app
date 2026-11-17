import { useParams } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { useSession } from "~/app/providers/SessionProvider"
import { fundState } from "~/domain/status"
import { useAdminFund } from "~/features/admin/shared/queries"
import { useHeldWrite } from "~/features/admin/shared/useHeldWrite"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { StatusBadge } from "~/ui/patterns/StatusBadge"
import { Card } from "~/ui/primitives/Card"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"

import { FundNotFound } from "./FundNotFound"
import { usePublishFundVersion, useTransitionFundLifecycle } from "./fundQueries"
import { FundStateCard } from "./FundStateCard"
import { latestTermsOf } from "./latestTerms"
import { PublishTermsSection } from "./PublishTermsSection"

const UNSENT = "The change could not be sent. Reload the page and try again."

const FundWorkspaceScreen = (): React.ReactElement => {
  const { fundId = "" } = useParams()
  const query = useAdminFund(fundId)
  const publish = useHeldWrite(usePublishFundVersion(fundId), UNSENT)
  const lifecycle = useHeldWrite(useTransitionFundLifecycle(fundId), UNSENT)
  const { hasAnyPermission } = useSession()
  const canWrite = hasAnyPermission(["funds.write"])
  const isLocked = publish.held !== null || lifecycle.held !== null
  const reload = (): void => {
    void query.refetch()
  }

  return (
    <AsyncBoundary
      query={query}
      fallback={
        <Page width="wide">
          <FundNotFound />
        </Page>
      }
      skeleton={
        <Page width="wide">
          <Card>
            <Skeleton height="1.4rem" width="50%" />
            <Skeleton height="1rem" width="30%" />
          </Card>
        </Page>
      }
    >
      {(data) => (
        <Page width="wide">
          <PageHeader
            eyebrow={data.fund.slug}
            title={data.fund.name ?? "Unnamed draft"}
            actions={<StatusBadge status={fundState(data.fund.status)} />}
          />

          <FundStateCard
            detail={data}
            lifecycle={lifecycle}
            canWrite={canWrite}
            isLocked={isLocked}
            onReload={reload}
          />

          {canWrite ? (
            <PublishTermsSection
              latest={latestTermsOf(data)}
              publish={publish}
              isLocked={isLocked}
              onReload={reload}
            />
          ) : (
            <Alert tone="info" title="Read only">
              Changing fund terms needs the funds.write permission.
            </Alert>
          )}
        </Page>
      )}
    </AsyncBoundary>
  )
}

export default FundWorkspaceScreen
