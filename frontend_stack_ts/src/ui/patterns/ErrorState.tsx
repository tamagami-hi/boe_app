import { supportReference } from "~/domain/reference"
import { Button } from "~/ui/primitives/Button"
import {
  STATE_DESCRIPTION,
  STATE_PANEL_ERROR,
  STATE_REFERENCE,
  STATE_TITLE,
} from "~/ui/recipes/state"

export type ErrorStateVariant =
  | "offline"
  | "timeout"
  | "server"
  | "forbidden"
  | "notFound"
  | "notConfigured"
  | "unknown"

export type ErrorStateProps = Readonly<{
  variant: ErrorStateVariant
  requestId?: string | null
  retryAfterSeconds?: number | null
  onRetry?: () => void
}>

const COPY: Readonly<Record<ErrorStateVariant, Readonly<{ title: string; description: string }>>> = {
  offline: {
    title: "No connection",
    description: "We can't reach BeOnEdge. Check your connection and try again.",
  },
  timeout: {
    title: "That took too long",
    description: "The request didn't finish in time. Nothing was changed. Please try again.",
  },
  server: {
    title: "Something went wrong",
    description: "This is on our side, not yours. Please try again in a moment.",
  },
  forbidden: {
    title: "Not available on this account",
    description: "This account doesn't have access to this. Contact support if you think it should.",
  },
  notFound: {
    title: "Not found",
    description: "This isn't available on your account. It may have moved or been removed.",
  },
  notConfigured: {
    title: "Not available right now",
    description: "This isn't available at the moment. Please try again later.",
  },
  unknown: {
    title: "We couldn't load this",
    description: "Something unexpected happened. Please try again.",
  },
}

export const ErrorState = ({
  variant,
  requestId,
  retryAfterSeconds,
  onRetry,
}: ErrorStateProps): React.ReactElement => {
  const copy = COPY[variant]
  const canRetry = onRetry !== undefined && variant !== "forbidden" && variant !== "notConfigured"
  const reference = supportReference(requestId)

  return (
    <div className={STATE_PANEL_ERROR} role="alert">
      <span className={STATE_TITLE}>{copy.title}</span>
      <p className={STATE_DESCRIPTION}>{copy.description}</p>
      {canRetry ? (
        <Button tone="secondary" size="sm" onClick={onRetry}>
          {typeof retryAfterSeconds === "number" && retryAfterSeconds > 0
            ? `Try again in ${String(retryAfterSeconds)}s`
            : "Try again"}
        </Button>
      ) : null}
      {reference === null ? null : (
        <span className={STATE_REFERENCE} data-support-reference={reference}>
          Reference {reference}
        </span>
      )}
    </div>
  )
}
