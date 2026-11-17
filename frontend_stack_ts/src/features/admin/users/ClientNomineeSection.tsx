import { useState } from "react"

import { isApiError, isUnknownWriteOutcome } from "~/api/errors"
import { mintIdempotencyKey } from "~/api/idempotency"
import { Section } from "~/app/layouts/Section"
import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { useSession } from "~/app/providers/SessionProvider"
import {
  NOMINEE_MAX_LENGTH,
  nomineeInput,
  nomineeProblems,
  nomineeRefusals,
  sameNominee,
  type NomineeDraft,
  type NomineeField,
  type NomineeInput,
  type NomineeProblems,
} from "~/domain/nominee"
import { ClientNomineeRequestPanel } from "~/features/admin/nominee-requests/ClientNomineeRequestPanel"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"
import { FormField, Input } from "~/ui/primitives/FormField"

import { ADMIN_FORM_GRID } from "~/ui/recipes/admin"
import { PROSE_SM } from "~/ui/recipes/datalist"
import { ACTION_ROW, STACK_LG } from "~/ui/recipes/layout"

import { useAdminUserNominee, useChangeAdminUserNominee, type AdminNomineeChange, type AdminUserNominee } from "./nomineeQueries"

type Held = Readonly<{ input: NomineeInput; expectedVersion: number; idempotencyKey: string }>

type Outcome =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "rejected"; message: string; refusals: NomineeProblems; reloadable: boolean }>
  | Readonly<{ kind: "unknown"; serverMessage: string | null }>

const IDLE: Outcome = { kind: "idle" }

const rejectionOf = (error: unknown): Outcome => {
  if (!isApiError(error)) {
    return { kind: "rejected", message: "The request could not be sent. Reload the page and try again.", refusals: {}, reloadable: false }
  }
  return {
    kind: "rejected",
    message: error.message,
    refusals: nomineeRefusals(error),
    reloadable: error.code === "STATE_CONFLICT",
  }
}

const savedMessage = (result: AdminNomineeChange): string => {
  if (result.status === "unchanged") return "That is already the nominee on this account. Nothing changed."
  if (result.nominee === null) return "The nominee was removed from this account."
  return `The nominee is now ${result.nominee.name} (${result.nominee.relation}).`
}

type FormProps = Readonly<{
  userId: string
  current: AdminUserNominee
  reloading: boolean
  onReload: () => Promise<boolean>
  onSaved: (result: AdminNomineeChange) => void
}>

const AdminNomineeForm = ({ userId, current, reloading, onReload, onSaved }: FormProps): React.ReactElement => {
  const change = useChangeAdminUserNominee(userId)
  const [draft, setDraft] = useState<NomineeDraft>({
    name: current.nominee?.name ?? "",
    relation: current.nominee?.relation ?? "",
  })
  const [held, setHeld] = useState<Held | null>(null)
  const [outcome, setOutcome] = useState<Outcome>(IDLE)
  const [confirmingRemoval, setConfirmingRemoval] = useState(false)

  const input = nomineeInput(draft)
  const problems = nomineeProblems(draft)
  const refusals = outcome.kind === "rejected" ? outcome.refusals : {}
  const unknown = outcome.kind === "unknown"
  const locked = change.isPending || unknown
  const ready = input !== null && Object.keys(problems).length === 0 && !sameNominee(input, current.nominee)
  const errorFor = (field: NomineeField): string | undefined => problems[field] ?? refusals[field]

  const send = (attempt: Held): void => {
    setHeld(attempt)
    if (outcome.kind === "rejected") setOutcome(IDLE)
    change.mutate(
      { input: attempt.input, expectedVersion: attempt.expectedVersion, idempotencyKey: attempt.idempotencyKey },
      {
        onSuccess: (result) => {
          setHeld(null)
          setOutcome(IDLE)
          onSaved(result)
        },
        onError: (error) => {
          if (isUnknownWriteOutcome(error)) {
            setOutcome({ kind: "unknown", serverMessage: isApiError(error) ? error.message : null })
            return
          }
          setHeld(null)
          setOutcome(rejectionOf(error))
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

  const reloadButton = (
    <Button
      size="sm"
      tone="ghost"
      disabled={change.isPending}
      loading={reloading}
      onClick={() => {
        void reload()
      }}
    >
      Reload the nominee
    </Button>
  )

  const isRemoval = input?.name === null

  const sendNew = (): void => {
    if (input !== null) send({ input, expectedVersion: current.version, idempotencyKey: mintIdempotencyKey() })
  }

  const edit = (field: NomineeField, value: string): void => {
    setDraft((previous) => ({ ...previous, [field]: value }))
  }

  return (
    <div className={STACK_LG}>
      {outcome.kind === "rejected" ? (
        <Alert tone="error" title="Nothing changed" {...(outcome.reloadable ? { action: reloadButton } : {})}>
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
                loading={change.isPending}
                onClick={() => {
                  send(held)
                }}
              >
                Check again
              </Button>
              {reloadButton}
            </span>
          }
        >
          {`The reply did not arrive, so it is not known whether the nominee was saved. Check again repeats the same request and cannot apply it twice. Reload the nominee to see what the account holds now; any change after that is a new request. ${outcome.serverMessage ?? ""}`.trim()}
        </Alert>
      ) : null}

      <div className={ADMIN_FORM_GRID}>
        <FormField label="Nominee's full name" error={errorFor("name")}>
          {({ id }) => (
            <Input
              id={id}
              value={draft.name}
              maxLength={NOMINEE_MAX_LENGTH}
              autoComplete="off"
              disabled={locked}
              onChange={(event) => {
                edit("name", event.target.value)
              }}
            />
          )}
        </FormField>
        <FormField label="Relation to the client" hint="For example spouse, son, daughter or parent." error={errorFor("relation")}>
          {({ id }) => (
            <Input
              id={id}
              value={draft.relation}
              maxLength={NOMINEE_MAX_LENGTH}
              autoComplete="off"
              disabled={locked}
              onChange={(event) => {
                edit("relation", event.target.value)
              }}
            />
          )}
        </FormField>
      </div>

      {unknown ? null : (
        <div className={ACTION_ROW}>
          {isRemoval ? (
            <Button
              tone="danger"
              disabled={locked || !ready}
              loading={change.isPending}
              onClick={() => {
                setConfirmingRemoval(true)
              }}
            >
              Remove the nominee
            </Button>
          ) : (
            <Button disabled={locked || !ready} loading={change.isPending} onClick={sendNew} trailing>
              Save the nominee
            </Button>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmingRemoval && current.nominee !== null}
        title="Remove the nominee?"
        description="This account will have no nominee. The change is audited, and the client can ask for a new nominee from their profile."
        confirmLabel="Remove the nominee"
        confirmTone="danger"
        cancelLabel="Keep the nominee"
        onConfirm={() => {
          setConfirmingRemoval(false)
          sendNew()
        }}
        onCancel={() => {
          setConfirmingRemoval(false)
        }}
      >
        {current.nominee === null ? null : (
          <DataList>
            <DetailRow label="Nominee">{current.nominee.name}</DetailRow>
            <DetailRow label="Relation">{current.nominee.relation}</DetailRow>
          </DataList>
        )}
      </ConfirmDialog>
    </div>
  )
}

type SectionProps = Readonly<{ userId: string; accountState: string }>

export const ClientNomineeSection = ({ userId, accountState }: SectionProps): React.ReactElement => {
  const query = useAdminUserNominee(userId)
  const { hasAnyPermission } = useSession()
  const canEdit = hasAnyPermission(["clients.create"]) && accountState !== "closed"
  const [saved, setSaved] = useState<AdminNomineeChange | null>(null)

  const reload = async (): Promise<boolean> => (await query.refetch()).isSuccess

  return (
    <Section
      title="Nominee"
      description="The person this client nominates and their relation to the client. The client asks for a change from their profile and you accept or decline it here; you can also set it directly. Every change is audited."
    >
      <Card>
        {saved === null ? null : (
          <Alert
            tone={saved.status === "unchanged" ? "info" : "success"}
            title={saved.status === "unchanged" ? "Nothing changed" : "Nominee updated"}
          >
            {savedMessage(saved)}
          </Alert>
        )}
        <AsyncBoundary query={query} skeleton={<Skeleton height="4rem" />}>
          {(data) => (
            <>
              {data.nominee === null ? (
                <p className={PROSE_SM}>No nominee is recorded for this client.</p>
              ) : (
                <DataList split>
                  <DetailRow label="Nominee">{data.nominee.name}</DetailRow>
                  <DetailRow label="Relation">{data.nominee.relation}</DetailRow>
                </DataList>
              )}
              <ClientNomineeRequestPanel userId={userId} nomineeVersion={data.version} accountState={accountState} />
              {canEdit ? (
                <AdminNomineeForm
                  key={String(data.version)}
                  userId={userId}
                  current={data}
                  reloading={query.isFetching}
                  onReload={reload}
                  onSaved={setSaved}
                />
              ) : (
                <p className={PROSE_SM}>
                  {accountState === "closed"
                    ? "This account is closed, so its nominee cannot be changed."
                    : "Changing the nominee needs the clients.create permission."}
                </p>
              )}
            </>
          )}
        </AsyncBoundary>
      </Card>
    </Section>
  )
}
