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

const SEND_LABEL = { invite: "Send a new invite link", reset: "Send a password reset link", unknown: "Send a new password link" } as const

type SendKind = keyof typeof SEND_LABEL

const sendKindOf = (access: ClientPasswordAccess | undefined): SendKind => {
  if (access === undefined) return "unknown"
  return access.hasPassword ? "reset" : "invite"
}

const inviteProblem = (access: ClientPasswordAccess): string | null => {
  if (access.hasPassword) return null
  const link = access.latestLink
  if (link === null) return "No invite link has been sent to this client yet."
  if (link.state === "expired") return `The invite link expired ${formatDateTime(link.expiresAt)}.`
  if (link.state === "closed") return "The latest invite link was replaced or retired and no longer works."
  if (link.delivery?.state === "cancelled") return "The invite email was cancelled before it was sent."
  if (link.delivery?.state === "permanent_failed") return "The invite email could not be delivered."
  return null
}

const CONFIRM_COPY: Readonly<Record<SendKind, Readonly<{ title: string; description: (email: string) => string }>>> = {
  invite: {
    title: "Send a new invite link?",
    description: (email) =>
      `A new link to set a first password is emailed to ${email}, and every earlier link stops working. After signing in, the client still confirms their email with a code before investing.`,
  },
  reset: {
    title: "Send a password reset link?",
    description: (email) =>
      `A link to reset the password is emailed to ${email}, and every earlier link stops working. Sending it does not change the password.`,
  },
  unknown: {
    title: "Send a new password link?",
    description: (email) =>
      `A link is emailed to ${email}. It sets a first password if the client has none, and resets it otherwise. Any earlier link stops working. Sending it does not change the password.`,
  },
}

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
        <DetailRow label="Link created">{formatDateTime(link.createdAt)}</DetailRow>
      )}
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
  const sendKind = sendKindOf(access.data)
  const problem = access.data === undefined ? null : inviteProblem(access.data)

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

  const readStatus = async (): Promise<void> => {
    if ((await access.refetch()).isSuccess) {
      setOutcome(IDLE)
      setAttempt((current) => current + 1)
    }
  }

  return (
    <Card>
      {outcome.kind === "sent" ? (
        <Alert tone="success" title={outcome.purpose === "set" ? "New invite link queued" : "New link queued"}>
          {`${PURPOSE_LABEL[outcome.purpose]} link queued for ${email}. It expires ${formatDateTime(outcome.expiresAt)}, and any earlier link no longer works. Watch the email state below.`}
        </Alert>
      ) : null}
      {outcome.kind !== "sent" && problem !== null && canSend && canReceive ? (
        <Alert tone="warning" title="The client cannot set a password yet">
          {`${problem} Send a new invite link to let them choose a password.`}
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
            <span className={ACTION_ROW}>
              <Button size="sm" loading={send.isPending} onClick={submit}>
                Check again
              </Button>
              <Button
                size="sm"
                tone="ghost"
                disabled={send.isPending}
                loading={access.isFetching}
                onClick={() => {
                  void readStatus()
                }}
              >
                Read the link status
              </Button>
            </span>
          }
        >
          {`The reply did not arrive, so it is not known whether a new link was queued. Check again repeats the same request and cannot queue a second link. If it keeps failing, read the link status: a link created at the time you sent was queued; otherwise you can send a new one. ${outcome.serverMessage ?? ""}`.trim()}
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
            {SEND_LABEL[sendKind]}
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
        title={CONFIRM_COPY[sendKind].title}
        description={CONFIRM_COPY[sendKind].description(email)}
        confirmLabel="Send the link"
        onConfirm={submit}
        onCancel={() => {
          setConfirming(false)
        }}
      />
    </Card>
  )
}
