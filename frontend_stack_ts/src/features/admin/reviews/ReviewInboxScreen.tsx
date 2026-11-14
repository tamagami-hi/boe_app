import { useState } from "react"
import { Link } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { formatDateTime } from "~/domain/dates"
import { REVIEW_STATE_OPTIONS, ratingText, reviewState, type ReviewState } from "~/domain/reviews"
import { AdminTable, FilterChip, FilterRow } from "~/features/admin/shared/AdminTable"
import { ClientPageLink } from "~/features/admin/shared/clientPageLink"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { LoadMore } from "~/ui/patterns/LoadMore"
import { StatusBadge } from "~/ui/patterns/StatusBadge"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"
import { ADMIN_CELL_LINK } from "~/ui/recipes/admin"
import { META_TEXT } from "~/ui/recipes/text"

import { commentExcerpt } from "./reviewPresentation"
import { useReviewInbox } from "./reviewQueries"

type StateFilter = ReviewState | "any"

const STATE_FILTERS: readonly Readonly<{ value: StateFilter; label: string }>[] = [
  ...REVIEW_STATE_OPTIONS,
  { value: "any", label: "All" },
]

const RATING_FILTERS: readonly Readonly<{ value: number | null; label: string }>[] = [
  { value: null, label: "Any rating" },
  ...[5, 4, 3, 2, 1].map((value) => ({ value, label: `${String(value)} out of 5` })),
]

const ReviewInboxScreen = (): React.ReactElement => {
  const [state, setState] = useState<StateFilter>("new")
  const [rating, setRating] = useState<number | null>(null)
  const query = useReviewInbox({ state: state === "any" ? null : state, rating })

  return (
    <Page width="wide">
      <PageHeader
        title="Reviews"
        description="Ratings and comments clients share in the app, newest first. Only administrators see them and nothing is published. Marking a review read or setting it aside changes nothing the client sees."
      />

      <FilterRow label="Review state">
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
      <FilterRow label="Rating">
        {RATING_FILTERS.map((option) => (
          <FilterChip
            key={option.label}
            active={option.value === rating}
            label={option.label}
            onSelect={() => {
              setRating(option.value)
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
        empty={
          <EmptyState
            title="No reviews here"
            description={state === "new" && rating === null ? "Every review has been read." : "Choose another filter."}
          />
        }
      >
        {(data) => (
          <AdminTable
            caption="Client reviews"
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
                key: "client",
                header: "Client",
                render: (row) => <ClientPageLink userId={row.userId}>{row.clientName}</ClientPageLink>,
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
    </Page>
  )
}

export default ReviewInboxScreen
