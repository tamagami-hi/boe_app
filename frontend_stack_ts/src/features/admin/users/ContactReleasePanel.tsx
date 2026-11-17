import { useState } from "react"

import { isApiError, isUnknownWriteOutcome } from "~/api/errors"
import { mintIdempotencyKey } from "~/api/idempotency"
import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { useSession } from "~/app/providers/SessionProvider"
import { formatDateTime } from "~/domain/dates"
import { Button } from "~/ui/primitives/Button"
import { Alert } from "~/ui/primitives/Feedback"
import { FormField, Input } from "~/ui/primitives/FormField"

import { PROSE_SM } from "~/ui/recipes/datalist"
import { ACTION_ROW, STACK_LG } from "~/ui/recipes/layout"

import { useReleaseUserContacts } from "./contactQueries"

type Held = Readonly<{ expectedVersion: number; reason: string; idempotencyKey: string }>

type Outcome =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "rejected"; message: string }>
  | Readonly<{ kind: "unknown"; serverMessage: string | null }>

const IDLE: Outcome = { kind: "idle" }

const rejectionMessage = (error: unknown): string =>
  isApiError(error) ? error.message : "The request could not be sent. Reload the page and try again."

export type ContactReleasePanelProps = Readonly<{
  userId: string
  version: number
  releasedAt: string | null
  reloading: boolean
  onReload: () => Promise<boolean>
}>

export const ContactReleasePanel = ({
  userId,
  version,
  releasedAt,
  reloading,
  onReload,
}: ContactReleasePanelProps): React.ReactElement => {
  const { hasAnyPermission } = useSession()
  const canRelease = hasAnyPermission(["users.close"])
  const releaseContacts = useReleaseUserContacts(userId)
  const [reason, setReason] = useState("")
  const [confirming, setConfirming] = useState(false)
  const [held, setHeld] = useState<Held | null>(null)
  const [outcome, setOutcome] = useState<Outcome>(IDLE)
  const unknown = outcome.kind === "unknown"

  if (releasedAt !== null) {
    return (
      <Alert tone="info" title="Email and phone released">
        {`Released ${formatDateTime(releasedAt)}. This closed account no longer holds its email address or phone number, so they can be used for a new account. The originals are kept in the history below.`}
      </Alert>
    )
  }

  const send = (attempt: Held): void => {
    setHeld(attempt)
    setConfirming(false)
    if (outcome.kind === "rejected") setOutcome(IDLE)
    releaseContacts.mutate(
      {
        expectedVersion: attempt.expectedVersion,
        idempotencyKey: attempt.idempotencyKey,
        ...(attempt.reason === "" ? {} : { reason: attempt.reason }),
      },
      {
        onSuccess: () => {
          setHeld(null)
          setOutcome(IDLE)
          setReason("")
        },
        onError: (error) => {
          if (isUnknownWriteOutcome(error)) {
            setOutcome({ kind: "unknown", serverMessage: isApiError(error) ? error.message : null })
            return
          }
          setHeld(null)
          setOutcome({ kind: "rejected", message: rejectionMessage(error) })
        },
      },
    )
  }

  const reload = async (): Promise<void> => {
    if (await onReload()) {
      setHeld(null)
      setOutcome(IDLE)
    }
  }

  if (!canRelease) {
    return (
      <p className={PROSE_SM}>
        This closed account still holds its email address and phone number. Your role cannot
        release them.
      </p>
    )
  }

  return (
    <div className={STACK_LG}>
      {outcome.kind === "rejected" ? (
        <Alert tone="error" title="Nothing changed">
          {outcome.message}
        </Alert>
      ) : null}
      {unknown && held !== null ? (
        <Alert
          tone="warning"
          title="Not confirmed"
          action={
            <span className={ACTION_ROW}>
              <Button
                size="sm"
                loading={releaseContacts.isPending}
                onClick={() => {
                  send(held)
                }}
              >
                Check again
              </Button>
              <Button
                size="sm"
                tone="ghost"
                disabled={releaseContacts.isPending}
                loading={reloading}
                onClick={() => {
                  void reload()
                }}
              >
                Reload the account
              </Button>
            </span>
          }
        >
          {`The reply did not arrive, so it is not known whether the email and phone were released. Check again repeats the same request and cannot apply it twice. ${outcome.serverMessage ?? ""}`.trim()}
        </Alert>
      ) : null}

      <p className={PROSE_SM}>
        This closed account still holds its email address and phone number, so no new account can use them. Releasing
        them keeps the originals in the history, leaves the account closed, and keeps its money records and statements.
      </p>

      <FormField label="Reason" hint="Recorded in the audit log and the contact history. Not shown to the investor.">
        {({ id }) => (
          <Input
            id={id}
            value={reason}
            maxLength={2_000}
            disabled={unknown || releaseContacts.isPending}
            onChange={(event) => {
              setReason(event.target.value)
            }}
          />
        )}
      </FormField>

      <div className={ACTION_ROW}>
        <Button
          tone="danger"
          disabled={unknown || releaseContacts.isPending}
          loading={releaseContacts.isPending && !unknown}
          onClick={() => {
            setConfirming(true)
          }}
        >
          Release email and phone
        </Button>
      </div>

      <ConfirmDialog
        open={confirming}
        title="Release this account's email and phone?"
        description="The closed account stops holding its email address and phone number, so a new account can use them. This cannot be undone from here. The originals stay in the contact history and the audit log."
        confirmLabel="Release them"
        confirmTone="danger"
        pending={releaseContacts.isPending}
        onConfirm={() => {
          send(held ?? { expectedVersion: version, reason: reason.trim(), idempotencyKey: mintIdempotencyKey() })
        }}
        onCancel={() => {
          setConfirming(false)
        }}
      />
    </div>
  )
}
