import { isSessionEnded } from "~/api/errors"
import type { PagedListState } from "~/api/paged"
import { Button } from "~/ui/primitives/Button"
import { Alert } from "~/ui/primitives/Feedback"
import { LOAD_MORE_ROOT } from "~/ui/recipes/state"
import { META_MUTED } from "~/ui/recipes/text"

export type LoadMoreProps = Readonly<{
  list: PagedListState
  noun: string
}>

export const LoadMore = ({ list, noun }: LoadMoreProps): React.ReactElement | null => {
  if (!list.hasMore) return null
  const isFailed = list.loadMoreError != null && !isSessionEnded(list.loadMoreError)
  return (
    <div className={LOAD_MORE_ROOT}>
      <span className={META_MUTED}>{`${String(list.loadedCount)} ${noun} so far`}</span>
      {isFailed ? (
        <Alert tone="error">{`More ${noun} could not be loaded, so this list is not complete.`}</Alert>
      ) : null}
      <Button tone="secondary" size="sm" loading={list.isLoadingMore} onClick={list.loadMore}>
        {isFailed ? "Try again" : "Show more"}
      </Button>
    </div>
  )
}
