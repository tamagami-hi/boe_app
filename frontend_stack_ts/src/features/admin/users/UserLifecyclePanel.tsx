import { useState } from "react"

import { isApiError, isUnknownWriteOutcome } from "~/api/errors"
import type { getAdminUser } from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { mintIdempotencyKey } from "~/api/idempotency"
import { Section } from "~/app/layouts/Section"
import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { useSession } from "~/app/providers/SessionProvider"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert } from "~/ui/primitives/Feedback"
import { FormField, Input } from "~/ui/primitives/FormField"

import { PROSE_SM } from "~/ui/recipes/datalist"
import { ACTION_ROW } from "~/ui/recipes/layout"

import { useUserLifecycle, type UserLifecycle } from "./userLifecycleQueries"

type AccountState = DataOf<typeof getAdminUser>["user"]["accountState"]

type HeldAction = Readonly<{ action: UserLifecycle; idempotencyKey: string }>

type Outcome =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "rejected"; message: string }>
  | Readonly<{ kind: "unknown"; serverMessage: string | null }>

const IDLE: Outcome = { kind: "idle" }

const COPY: Readonly<Record<UserLifecycle, Readonly<{ title: string; description: string; done: string }>>> = {
  suspend: {
    title: "Suspend this account?",
    description:
      "Every session is revoked immediately and the investor cannot sign in or invest. Their money and values are untouched. You can reinstate them.",
    done: "suspended",
  },
  reinstate: {
    title: "Reinstate this account?",
    description: "The investor can sign in and invest again. Existing sessions stay revoked.",
    done: "reinstated",
  },
  close: {
    title: "Close this account?",
    description:
      "Every session is revoked and the account cannot be reopened from here. Their money and values are untouched, and their statements remain.",
    done: "closed",
  },
}

const rejectionMessage = (error: unknown): string =>
  isApiError(error) ? error.message : "We could not apply that change. Nothing has changed."

export type UserLifecyclePanelProps = Readonly<{
  userId: string
  accountState: AccountState
  reloading: boolean
  onReload: () => Promise<boolean>
}>

export const UserLifecyclePanel = ({
  userId,
  accountState,
  reloading,
  onReload,
}: UserLifecyclePanelProps): React.ReactElement => {
  const lifecycle = useUserLifecycle(userId)
  const { hasAnyPermission, principal } = useSession()
  const [pending, setPending] = useState<UserLifecycle | null>(null)
  const [held, setHeld] = useState<HeldAction | null>(null)
  const [outcome, setOutcome] = useState<Outcome>(IDLE)
  const [reason, setReason] = useState("")

  const ownAccount = principal !== null && principal.userId.toLowerCase() === userId.toLowerCase()
  const canSuspend = hasAnyPermission(["users.suspend"])
  const canClose = hasAnyPermission(["users.close"])
  const unknown = outcome.kind === "unknown"
  const busy = lifecycle.isPending || unknown

  const run = (action: UserLifecycle): void => {
    const attempt = held !== null && held.action === action ? held : { action, idempotencyKey: mintIdempotencyKey() }
    setHeld(attempt)
    if (outcome.kind === "rejected") setOutcome(IDLE)
    lifecycle.mutate(
      {
        action,
        idempotencyKey: attempt.idempotencyKey,
        reasonCode: `admin_${action}`,
        ...(reason.trim() === "" ? {} : { reason: reason.trim() }),
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
        onSettled: () => {
          setPending(null)
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

  return (
    <Section
      title="Account lifecycle"
      description="Suspending or closing an account revokes every session on it immediately."
    >
      <Card>
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
                  loading={lifecycle.isPending}
                  onClick={() => {
                    run(held.action)
                  }}
                >
                  Check again
                </Button>
                <Button
                  size="sm"
                  tone="ghost"
                  disabled={lifecycle.isPending}
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
            {`The reply did not arrive, so it is not known whether the account was ${COPY[held.action].done}. Check again repeats the same request and cannot apply it twice. Reload the account to see its current state; any change after that is a new request. ${outcome.serverMessage ?? ""}`.trim()}
          </Alert>
        ) : null}

        <FormField label="Reason" hint="Recorded in the audit log. Not shown to the investor.">
          {({ id }) => (
            <Input
              id={id}
              value={reason}
              maxLength={2_000}
              disabled={unknown}
              onChange={(event) => {
                setReason(event.target.value)
              }}
            />
          )}
        </FormField>

        <div className={ACTION_ROW}>
          {accountState === "active" && canSuspend && !ownAccount ? (
            <Button
              tone="danger"
              disabled={busy}
              onClick={() => {
                setPending("suspend")
              }}
            >
              Suspend
            </Button>
          ) : null}
          {accountState === "suspended" && canSuspend ? (
            <Button
              disabled={busy}
              onClick={() => {
                setPending("reinstate")
              }}
            >
              Reinstate
            </Button>
          ) : null}
          {accountState !== "closed" && canClose && !ownAccount ? (
            <Button
              tone="danger"
              disabled={busy}
              onClick={() => {
                setPending("close")
              }}
            >
              Close
            </Button>
          ) : null}
        </div>

        {ownAccount ? (
          <p className={PROSE_SM}>You cannot suspend or close your own account. Another admin can do this.</p>
        ) : !canSuspend && !canClose ? (
          <p className={PROSE_SM}>Changing an account state needs the users.suspend or users.close permission.</p>
        ) : null}
      </Card>

      {pending === null ? null : (
        <ConfirmDialog
          open
          title={COPY[pending].title}
          description={COPY[pending].description}
          confirmLabel={pending === "reinstate" ? "Reinstate" : "Confirm"}
          confirmTone={pending === "reinstate" ? "primary" : "danger"}
          pending={lifecycle.isPending}
          onConfirm={() => {
            run(pending)
          }}
          onCancel={() => {
            setPending(null)
          }}
        />
      )}
    </Section>
  )
}
