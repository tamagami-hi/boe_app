import { useState } from "react"

import { isApiError, isUnknownWriteOutcome } from "~/api/errors"
import { useIdempotencyKey } from "~/api/idempotency"
import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { useSession } from "~/app/providers/SessionProvider"
import { formatDateTime } from "~/domain/dates"
import { emailDeliveryState } from "~/domain/status"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { StatusBadge } from "~/ui/patterns/StatusBadge"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"
import { PROSE_SM } from "~/ui/recipes/datalist"
import { ACTION_ROW } from "~/ui/recipes/layout"

import {
  useAdminClientPasswordAccess,
  useSendClientPasswordLink,
  type ClientPasswordAccess,
} from "./passwordLinkQueries"

const PURPOSE_LABEL = { set: "Set a first password", reset: "Reset the password" } as const

const LINK_STATE_LABEL = {
  active: "Usable",
  expired: "Expired",
  closed: "Used or replaced",
} as const

type Outcome =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "sent"; expiresAt: string; purpose: "set" | "reset" }>
  | Readonly<{ kind: "rejected"; message: string }>
  | Readonly<{ kind: "unknown"; serverMessage: string | null }>

const IDLE: Outcome = { kind: "idle" }

const rejectionMessage = (error: unknown): string => {
  if (!isApiError(error)) return "The request could not be sent. Reload the page and try again."
  if (error.code === "RATE_LIMITED") return "A link was sent moments ago. Wait for the cooldown to end, then try again."
  return error.message
}

const LinkStatus = ({ access }: Readonly<{ access: ClientPasswordAccess }>): React.ReactElement => {
  const link = access.latestLink
  return (
    <DataList split>
      <DetailRow label="Password">{access.hasPassword ? "Set" : "Not set yet"}</DetailRow>
      <DetailRow label="Latest link">
        {link === null ? "None sent yet" : `${PURPOSE_LABEL[link.purpose]}, ${LINK_STATE_LABEL[link.state]}`}
      </DetailRow>
      {link === null ? null : (
        <DetailRow label="Link expires">{formatDateTime(link.expiresAt)}</DetailRow>
      )}
      {link?.delivery == null ? null : (
        <DetailRow label="Email">
          <StatusBadge status={emailDeliveryState(link.delivery.state)} />
          {link.delivery.lastErrorCode === null ? null : ` ${link.delivery.lastErrorCode}`}
        </DetailRow>
      )}
      <DetailRow label="Next link allowed">
        {access.nextLinkAllowedAt === null ? "Now" : formatDateTime(access.nextLinkAllowedAt)}
      </DetailRow>
    </DataList>
  )
}

export type PasswordLinkPanelProps = Readonly<{
  userId: string
  email: string
  canReceive: boolean
}>

export const PasswordLinkPanel = ({ userId, email, canReceive }: PasswordLinkPanelProps): React.ReactElement => {
  const { hasAnyPermission } = useSession()
  const canSend = hasAnyPermission(["clients.password_links.send"])
  const access = useAdminClientPasswordAccess(userId)
  const send = useSendClientPasswordLink(userId)
  const [attempt, setAttempt] = useState(0)
  const [outcome, setOutcome] = useState<Outcome>(IDLE)
  const [confirming, setConfirming] = useState(false)
  const idempotencyKey = useIdempotencyKey({ userId, attempt })

  const coolingDown =
    access.data?.nextLinkAllowedAt != null && Date.parse(access.data.nextLinkAllowedAt) > Date.now()

  const submit = (): void => {
    setConfirming(false)
    send.mutate(
      { idempotencyKey },
      {
        onSuccess: (sent) => {
          setOutcome({ kind: "sent", expiresAt: sent.expiresAt, purpose: sent.purpose })
          setAttempt((current) => current + 1)
        },
        onError: (error) => {
          if (isUnknownWriteOutcome(error)) {
            setOutcome({ kind: "unknown", serverMessage: isApiError(error) ? error.message : null })
            return
          }
          setOutcome({ kind: "rejected", message: rejectionMessage(error) })
          setAttempt((current) => current + 1)
        },
      },
    )
  }

  return (
    <Card>
      {outcome.kind === "sent" ? (
        <Alert tone="success" title="New link queued">
          {`${PURPOSE_LABEL[outcome.purpose]} link queued for ${email}. It expires ${formatDateTime(outcome.expiresAt)}, and any earlier link no longer works. Watch the email state below.`}
        </Alert>
      ) : null}
      {outcome.kind === "rejected" ? (
        <Alert tone="error" title="No link sent">
          {outcome.message}
        </Alert>
      ) : null}
      {outcome.kind === "unknown" ? (
        <Alert
          tone="warning"
          title="Not confirmed"
          action={
            <Button size="sm" loading={send.isPending} onClick={submit}>
              Check again
            </Button>
          }
        >
          {`The reply did not arrive, so it is not known whether a new link was queued. Check again repeats the same request and cannot queue a second link. ${outcome.serverMessage ?? ""}`.trim()}
        </Alert>
      ) : null}

      <AsyncBoundary query={access} skeleton={<Skeleton height="3rem" />}>
        {(data) => <LinkStatus access={data} />}
      </AsyncBoundary>

      {canSend && canReceive ? (
        <div className={ACTION_ROW}>
          <Button
            disabled={send.isPending || coolingDown || outcome.kind === "unknown"}
            loading={send.isPending && outcome.kind !== "unknown"}
            onClick={() => {
              setConfirming(true)
            }}
          >
            Send a new password link
          </Button>
          <Button
            tone="ghost"
            disabled={access.isFetching}
            onClick={() => {
              void access.refetch()
            }}
          >
            Refresh
          </Button>
        </div>
      ) : (
        <p className={PROSE_SM}>
          {canSend
            ? "Password links are only sent to active client accounts."
            : "Sending a password link needs the clients.password_links.send permission."}
        </p>
      )}

      <ConfirmDialog
        open={confirming}
        title="Send a new password link?"
        description={`A link is emailed to ${email}. It sets a first password if the client has none, and resets it otherwise. Any earlier link stops working. Sending it does not change the password.`}
        confirmLabel="Send the link"
        onConfirm={submit}
        onCancel={() => {
          setConfirming(false)
        }}
      />
    </Card>
  )
}
