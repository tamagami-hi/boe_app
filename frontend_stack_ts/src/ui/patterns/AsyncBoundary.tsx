import type { ReactNode } from "react"

import { ApiError, isApiError, isTransportError } from "~/api/errors"
import type { TransportError } from "~/api/errors"
import { Spinner } from "~/ui/primitives/Feedback"
import { ErrorState } from "~/ui/patterns/ErrorState"
import type { ErrorStateVariant } from "~/ui/patterns/ErrorState"

import styles from "./States.module.css"

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

const isSessionEndingError = (error: unknown): boolean =>
  isApiError(error) &&
  (error.code === "AUTHENTICATION_REQUIRED" || error.code === "SESSION_INVALID")

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
    if (isSessionEndingError(error)) return null
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
    <div className={styles.stack}>
      {isFetching === true && !isPending ? (
        <span className={styles.refreshing}>
          <Spinner size="sm" label="Refreshing" />
          Refreshing
        </span>
      ) : null}
      {emptyRendering ?? children(data)}
    </div>
  )
}

export const transportErrorVariant = (error: TransportError): ErrorStateVariant =>
  errorVariantOf(error, false)
