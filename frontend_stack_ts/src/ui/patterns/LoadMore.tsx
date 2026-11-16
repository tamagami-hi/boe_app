import { useEffect, useId, useRef } from "react"
import type { MouseEvent } from "react"

import { isSessionEnded } from "~/api/errors"
import type { PagedListState } from "~/api/paged"
import { errorVariantOf } from "~/ui/patterns/AsyncBoundary"
import { Button } from "~/ui/primitives/Button"
import { Alert } from "~/ui/primitives/Feedback"
import { LOAD_MORE_ROOT } from "~/ui/recipes/state"
import { META_MUTED } from "~/ui/recipes/text"

export type LoadMoreProps = Readonly<{
  list: PagedListState
  noun: string
}>

type PressHandler = (event: MouseEvent<HTMLButtonElement>) => void

const hasLostFocus = (): boolean =>
  document.activeElement === null || document.activeElement === document.body

const useFocusKeptWhileLoading = (isLoading: boolean): PressHandler => {
  const pressed = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (isLoading) return
    const button = pressed.current
    pressed.current = null
    if (button?.isConnected === true && hasLostFocus()) button.focus()
  }, [isLoading])

  return (event) => {
    pressed.current = document.activeElement === event.currentTarget ? event.currentTarget : null
  }
}

export const LoadMore = ({ list, noun }: LoadMoreProps): React.ReactElement | null => {
  const failureId = useId()
  const notePress = useFocusKeptWhileLoading(list.isLoadingMore)
  if (!list.hasMore) return null
  const isFailed = list.loadMoreError != null && !isSessionEnded(list.loadMoreError)
  const canRetry = !isFailed || errorVariantOf(list.loadMoreError, false) !== "forbidden"
  return (
    <div className={LOAD_MORE_ROOT}>
      <span className={META_MUTED}>{`${String(list.loadedCount)} ${noun} so far`}</span>
      {isFailed ? (
        <Alert tone="error">
          <span id={failureId}>{`More ${noun} could not be loaded, so this list is not complete.`}</span>
        </Alert>
      ) : null}
      {canRetry ? (
        <Button
          tone="secondary"
          size="sm"
          loading={list.isLoadingMore}
          aria-describedby={isFailed ? failureId : undefined}
          onClick={(event) => {
            notePress(event)
            list.loadMore()
          }}
        >
          {isFailed ? "Try again" : "Show more"}
        </Button>
      ) : null}
    </div>
  )
}
