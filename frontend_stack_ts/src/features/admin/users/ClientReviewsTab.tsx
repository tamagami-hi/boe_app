import { Link } from "react-router-dom"

import { formatDateTime } from "~/domain/dates"
import { ratingText, reviewState } from "~/domain/reviews"
import { commentExcerpt } from "~/features/admin/reviews/reviewPresentation"
import { useUserReviews } from "~/features/admin/reviews/reviewQueries"
import { AdminTable } from "~/features/admin/shared/AdminTable"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { LoadMore } from "~/ui/patterns/LoadMore"
import { StatusBadge } from "~/ui/patterns/StatusBadge"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"
import { ADMIN_CELL_LINK } from "~/ui/recipes/admin"
import { META_TEXT } from "~/ui/recipes/text"

type Props = Readonly<{ userId: string }>

export const ClientReviewsTab = ({ userId }: Props): React.ReactElement => {
  const query = useUserReviews(userId)

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
        empty={<EmptyState title="No reviews" description="This account has not shared a review in the app." />}
      >
        {(data) => (
          <AdminTable
            caption="Reviews from this account"
            rows={data.items}
            rowKey={(row) => row.id}
            columns={[
              {
                key: "rating",
                header: "Review",
                render: (row) => (
                  <Link to={`/reviews/${row.id}`} className={ADMIN_CELL_LINK}>
                    {ratingText(row.rating)}
                  </Link>
                ),
              },
              {
                key: "comment",
                header: "Comment",
                render: (row) => <span className={META_TEXT}>{commentExcerpt(row.comment)}</span>,
              },
              { key: "state", header: "State", render: (row) => <StatusBadge status={reviewState(row.state)} /> },
              { key: "shared", header: "Shared", render: (row) => formatDateTime(row.createdAt) },
            ]}
          />
        )}
      </AsyncBoundary>
      <LoadMore list={query} noun="reviews" />
    </>
  )
}
