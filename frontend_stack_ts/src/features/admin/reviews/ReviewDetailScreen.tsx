import { useParams } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { useSession } from "~/app/providers/SessionProvider"
import { formatDateTime } from "~/domain/dates"
import { ratingText, reviewState } from "~/domain/reviews"
import { cx } from "~/lib/cx"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { StatusBadge } from "~/ui/patterns/StatusBadge"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"
import { PROSE_PRE, PROSE_SM } from "~/ui/recipes/datalist"

import { ClientLink, useCanOpenClient } from "./reviewPresentation"
import { ReviewModerationForm } from "./ReviewModerationForm"
import { useReview, type ReviewDetail } from "./reviewQueries"

const MESSAGE_TEXT = cx(PROSE_SM, PROSE_PRE)

const ReviewSummary = ({ review }: Readonly<{ review: ReviewDetail }>): React.ReactElement => {
  const canOpenClient = useCanOpenClient()
  return (
    <Section title="Review">
      <Card>
        <DataList split>
          <DetailRow label="Client" emphasis="lead">
            <ClientLink userId={review.userId} name={review.clientName} canOpen={canOpenClient} />
          </DetailRow>
          <DetailRow label="Rating">{ratingText(review.rating)}</DetailRow>
          <DetailRow label="State">
            <StatusBadge status={reviewState(review.state)} />
          </DetailRow>
          <DetailRow label="Shared">{formatDateTime(review.createdAt)}</DetailRow>
          {review.moderatedAt === null ? null : (
            <DetailRow label="Last changed">
              {`${formatDateTime(review.moderatedAt)} by ${review.moderatorName ?? "an administrator"}`}
            </DetailRow>
          )}
        </DataList>
      </Card>
      <Card>
        <p className={MESSAGE_TEXT}>{review.comment ?? "The client left no comment."}</p>
      </Card>
    </Section>
  )
}

const ReviewDetailScreen = (): React.ReactElement => {
  const { reviewId = "" } = useParams()
  const query = useReview(reviewId)
  const { hasAnyPermission } = useSession()
  const canModerate = hasAnyPermission(["support.write"])
  const reload = async (): Promise<ReviewDetail | null> => {
    const result = await query.refetch()
    return result.isSuccess ? result.data : null
  }

  return (
    <Page width="wide">
      <PageHeader title="Client review" description="A rating and comment a client shared in the app. Only administrators see it." />

      <AsyncBoundary
        query={query}
        skeleton={
          <Card>
            <Skeleton height="1.2rem" width="45%" />
            <Skeleton height="3rem" />
          </Card>
        }
      >
        {(review) => (
          <>
            <ReviewSummary review={review} />
            <Section title="Handling" description="Mark the review read, or set it aside, with an optional note for other administrators.">
              {review.moderationNote === null ? null : (
                <Card>
                  <p className={MESSAGE_TEXT}>{review.moderationNote}</p>
                </Card>
              )}
              {canModerate ? (
                <Card elevated>
                  <ReviewModerationForm review={review} reloading={query.isFetching} onReload={reload} />
                </Card>
              ) : (
                <p className={PROSE_SM}>Your account can read reviews but cannot change their state.</p>
              )}
            </Section>
          </>
        )}
      </AsyncBoundary>
    </Page>
  )
}

export default ReviewDetailScreen
