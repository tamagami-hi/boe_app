import type { PagedListState } from "~/api/paged"
import { Button } from "~/ui/primitives/Button"
import { LOAD_MORE_ROOT } from "~/ui/recipes/state"
import { META_MUTED } from "~/ui/recipes/text"

export type LoadMoreProps = Readonly<{
  list: PagedListState
  noun: string
}>

export const LoadMore = ({ list, noun }: LoadMoreProps): React.ReactElement | null => {
  if (!list.hasMore) return null
  return (
    <div className={LOAD_MORE_ROOT}>
      <span className={META_MUTED}>
        {`Showing the first ${String(list.loadedCount)} ${noun}. There are more.`}
      </span>
      <Button
        tone="secondary"
        size="sm"
        loading={list.isLoadingMore}
        onClick={list.loadMore}
      >
        Load more
      </Button>
    </div>
  )
}
