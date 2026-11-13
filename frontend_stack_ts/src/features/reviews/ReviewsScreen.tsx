import { useState } from "react"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { formatDate, formatDateTime } from "~/domain/dates"
import { ratingText } from "~/domain/reviews"
import { cx } from "~/lib/cx"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { LoadMore } from "~/ui/patterns/LoadMore"
import { Card } from "~/ui/primitives/Card"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"
import { ITEM_TITLE, PROSE_PRE, PROSE_SM } from "~/ui/recipes/datalist"
import { CARD_COLUMNS, FIELD_MEASURE } from "~/ui/recipes/layout"
import { CARD_STACK } from "~/ui/recipes/surface"
import { META_ROW } from "~/ui/recipes/text"

import { ReviewForm, type ReviewOutcome } from "./ReviewForm"
import { useClientReviews, type ClientReviews } from "./reviewQueries"

const COMMENT_TEXT = cx(PROSE_SM, PROSE_PRE)

const NextReview = ({ data }: Readonly<{ data: ClientReviews }>): React.ReactElement => (
  <Card>
    <p className={PROSE_SM}>
      {data.nextSubmissionOn === null
        ? "You have shared a review this month."
        : `You have shared a review this month. You can share another from ${formatDate(data.nextSubmissionOn)}.`}
    </p>
  </Card>
)

const ReviewList = ({ data }: Readonly<{ data: ClientReviews }>): React.ReactElement => (
  <div className={cx(CARD_STACK, CARD_COLUMNS[2])}>
    {data.items.map((review) => (
      <Card key={review.id}>
        <span className={ITEM_TITLE}>{ratingText(review.rating)}</span>
        {review.comment === null ? null : <p className={COMMENT_TEXT}>{review.comment}</p>}
        <div className={META_ROW}>
          <span>Shared {formatDateTime(review.submittedAt)}</span>
        </div>
      </Card>
    ))}
  </div>
)

const ReviewsScreen = (): React.ReactElement => {
  const reviews = useClientReviews()
  const [notice, setNotice] = useState<ReviewOutcome | null>(null)

  return (
    <Page width="default">
      <PageHeader
        title="Reviews"
        description="Rate BeOnEdge and tell the team what works for you and what does not. Only the BeOnEdge team reads reviews. They are not published."
      />

      {notice === "sent" ? (
        <Alert tone="success" title="Review received">
          Thank you. The BeOnEdge team reads every review.
        </Alert>
      ) : null}
      {notice === "existing" ? (
        <Alert tone="info" title="A review for this month already exists">
          BeOnEdge already holds a review from you for this month, perhaps sent from another device, so this one was not
          added. The date of your next review is shown below.
        </Alert>
      ) : null}

      <AsyncBoundary
        query={reviews}
        skeleton={
          <Card>
            <Skeleton height="1rem" width="55%" />
            <Skeleton height="3rem" />
          </Card>
        }
      >
        {(data) => (
          <>
            <Section title="Share a review" description="One review a month. The comment is optional.">
              {data.canSubmit ? (
                <Card elevated>
                  <div className={FIELD_MEASURE}>
                    <ReviewForm latestKnownId={data.items[0]?.id ?? null} onOutcome={setNotice} />
                  </div>
                </Card>
              ) : (
                <NextReview data={data} />
              )}
            </Section>

            <Section title="Your reviews">
              {data.items.length === 0 ? (
                <EmptyState title="No reviews yet" description="Reviews you share appear here." />
              ) : (
                <ReviewList data={data} />
              )}
            </Section>
          </>
        )}
      </AsyncBoundary>
      <LoadMore list={reviews} noun="reviews" />
    </Page>
  )
}

export default ReviewsScreen
