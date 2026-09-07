import type { ReactNode } from "react"

import { ApiError, isApiError, isSessionEnded, isTransportError } from "~/api/errors"
import { Spinner } from "~/ui/primitives/Feedback"
import { ErrorState } from "~/ui/patterns/ErrorState"
import type { ErrorStateVariant } from "~/ui/patterns/ErrorState"

import { STATE_REFRESHING, STATE_REFRESH_SLOT, STATE_STACK } from "~/ui/recipes/state"

export type AsyncQuery<TData> = Readonly<{
  data: TData | undefined
  isPending: boolean
  isFetching?: boolean
  error: unknown
  refetch?: () => void
}>

export type AsyncBoundaryProps<TData> = Readonly<{
  query: AsyncQuery<TData>
  skeleton: ReactNode
  empty?: ReactNode
  isEmpty?: (data: TData) => boolean
  notConfigured?: boolean
  fallback?: ReactNode
  children: (data: TData) => ReactNode
}>

export const errorVariantOf = (error: unknown, notConfigured: boolean): ErrorStateVariant => {
  if (isTransportError(error)) {
    if (error.kind === "offline") return "offline"
    if (error.kind === "timeout") return "timeout"
    return "unknown"
  }
  if (!isApiError(error)) return "unknown"
  if (error.code === "AUTHORIZATION_DENIED") return "forbidden"
  if (error.code === "RESOURCE_NOT_FOUND") return notConfigured ? "notConfigured" : "notFound"
  if (error.code === "INTERNAL_ERROR" || error.code === "DEPENDENCY_UNAVAILABLE") return "server"
  return error.status >= 500 ? "server" : "unknown"
}

export const AsyncBoundary = <TData,>({
  query,
  skeleton,
  empty,
  isEmpty,
  notConfigured = false,
  fallback,
  children,
}: AsyncBoundaryProps<TData>): React.ReactElement | null => {
  const { data, error, isPending, isFetching, refetch } = query

  if (error !== null && error !== undefined && data === undefined) {
    if (isSessionEnded(error)) return null
    if (fallback !== undefined && isApiError(error) && error.code === "RESOURCE_NOT_FOUND") {
      return <>{fallback}</>
    }
    const requestId = error instanceof ApiError ? error.requestId : null
    const retryAfterSeconds = error instanceof ApiError ? error.retryAfterSeconds : null
    return (
      <ErrorState
        variant={errorVariantOf(error, notConfigured)}
        requestId={requestId}
        retryAfterSeconds={retryAfterSeconds}
        {...(refetch === undefined ? {} : { onRetry: refetch })}
      />
    )
  }

  if (data === undefined) {
    if (isPending) return <>{skeleton}</>
    return <ErrorState variant="unknown" {...(refetch === undefined ? {} : { onRetry: refetch })} />
  }

  const emptyRendering = empty !== undefined && isEmpty?.(data) === true ? empty : null

  return (
    <div className={STATE_STACK}>
      <span className={STATE_REFRESH_SLOT} aria-hidden={isFetching !== true || isPending}>
        {isFetching === true && !isPending ? (
          <span className={STATE_REFRESHING}>
            <Spinner size="sm" label="Updating" />
            Updating
          </span>
        ) : null}
      </span>
      {emptyRendering ?? children(data)}
    </div>
  )
}
