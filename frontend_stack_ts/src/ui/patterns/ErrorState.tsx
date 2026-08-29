import { Button } from "~/ui/primitives/Button"
import {
  STATE_DESCRIPTION,
  STATE_PANEL,
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
    title: "We cannot reach BeOnEdge",
    description:
      "Your device appears to be offline. Nothing has been lost — check your connection and try again.",
  },
  timeout: {
    title: "That took too long",
    description: "The request did not finish in time. Nothing was changed. Try again.",
  },
  server: {
    title: "Something went wrong on our side",
    description: "This is not your fault. Try again in a moment.",
  },
  forbidden: {
    title: "You do not have access to this",
    description: "Your account does not carry the permission this screen needs.",
  },
  notFound: {
    title: "Not found",
    description: "This does not exist, or it is not available to your account.",
  },
  notConfigured: {
    title: "Not configured in this environment",
    description:
      "This capability depends on a payment provider that is not set up here. It is not an error.",
  },
  unknown: {
    title: "We could not load this",
    description: "Something unexpected happened. Quote the reference below if you contact support.",
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

  return (
    <div className={STATE_PANEL} role="alert">
      <span className={STATE_TITLE}>{copy.title}</span>
      <p className={STATE_DESCRIPTION}>{copy.description}</p>
      {typeof requestId === "string" && requestId !== "" ? (
        <span className={STATE_REFERENCE}>Reference {requestId}</span>
      ) : null}
      {canRetry ? (
        <Button tone="secondary" size="sm" onClick={onRetry}>
          {typeof retryAfterSeconds === "number" && retryAfterSeconds > 0
            ? `Try again in ${String(retryAfterSeconds)}s`
            : "Try again"}
        </Button>
      ) : null}
    </div>
  )
}
