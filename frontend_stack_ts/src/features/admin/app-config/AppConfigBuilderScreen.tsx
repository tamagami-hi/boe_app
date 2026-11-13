import { useEffect, useState } from "react"

import { hasCode, isApiError, isUnknownWriteOutcome } from "~/api/errors"
import { useIdempotencyKey } from "~/api/idempotency"
import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { useSession } from "~/app/providers/SessionProvider"
import { formatDateTime } from "~/domain/dates"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"
import { FormField, Input } from "~/ui/primitives/FormField"

import { ADMIN_CODE, ADMIN_JSON_AREA } from "~/ui/recipes/admin"
import { PROSE_SM } from "~/ui/recipes/datalist"
import { STACK_LG } from "~/ui/recipes/layout"

import type { AdminAppConfig, AppConfigInput } from "./appConfigQueries"
import { useAdminAppConfig, usePublishAppConfig } from "./appConfigQueries"

const TEMPLATE = {
  featureFlags: {},
  minimumSupportedVersion: {},
  downloads: {},
  maintenance: { enabled: false },
  presentation: {},
} as const

type Failure =
  | Readonly<{ kind: "conflict" }>
  | Readonly<{ kind: "unknown" }>
  | Readonly<{ kind: "rejected"; message: string }>

const describeFailure = (error: unknown): Failure => {
  if (hasCode(error, "STATE_CONFLICT")) return { kind: "conflict" }
  if (isUnknownWriteOutcome(error)) return { kind: "unknown" }
  if (isApiError(error) && error.code === "VALIDATION_FAILED") {
    return {
      kind: "rejected",
      message:
        "The backend refused that configuration. Only the documented keys are accepted, and the version strings must be dotted numbers.",
    }
  }
  return { kind: "rejected", message: isApiError(error) ? error.message : "We could not publish that." }
}

const draftOf = (data: AdminAppConfig): string => JSON.stringify(data.config ?? TEMPLATE, null, 2)

const parseDraft = (draft: string | null): AppConfigInput | null => {
  if (draft === null) return null
  try {
    const value: unknown = JSON.parse(draft)
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null
    return { config: value }
  } catch {
    return null
  }
}

const AppConfigBuilderScreen = (): React.ReactElement => {
  const query = useAdminAppConfig()
  const publish = usePublishAppConfig()
  const { hasAnyPermission } = useSession()
  const [draft, setDraft] = useState<string | null>(null)
  const [editedFrom, setEditedFrom] = useState<number | null | undefined>(undefined)
  const [reason, setReason] = useState("")
  const [confirming, setConfirming] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [isReloading, setIsReloading] = useState(false)

  const canPublish = hasAnyPermission(["config.publish"])
  const current = query.data ?? null
  const parsed = parseDraft(draft)
  const trimmedReason = reason.trim()
  const body: AppConfigInput | null =
    parsed === null || editedFrom === undefined
      ? null
      : { ...parsed, expectedVersion: editedFrom, ...(trimmedReason === "" ? {} : { reason: trimmedReason }) }
  const idempotencyKey = useIdempotencyKey(body)
  const isDraftBehind = editedFrom !== undefined && current !== null && current.version !== editedFrom

  useEffect(() => {
    if (draft !== null || current === null) return
    setDraft(draftOf(current))
    setEditedFrom(current.version)
  }, [current, draft])

  const reload = async (): Promise<void> => {
    setIsReloading(true)
    const result = await query.refetch()
    setIsReloading(false)
    if (result.isError || result.data === undefined) {
      setFailure({ kind: "rejected", message: "The published configuration could not be loaded. Try again." })
      return
    }
    setFailure(null)
    setDraft(draftOf(result.data))
    setEditedFrom(result.data.version)
  }

  const send = (): void => {
    setFailure(null)
    if (body === null) {
      setFailure({ kind: "rejected", message: "That is not a JSON object. Fix the syntax before publishing." })
      setConfirming(false)
      return
    }
    publish.mutate(
      { ...body, idempotencyKey },
      {
        onError: (error) => {
          setFailure(describeFailure(error))
        },
        onSuccess: (published) => {
          setReason("")
          setDraft(draftOf(published))
          setEditedFrom(published.version)
        },
        onSettled: () => {
          setConfirming(false)
        },
      },
    )
  }

  const reloadAction = (
    <Button
      tone="secondary"
      size="sm"
      loading={isReloading}
      onClick={() => {
        void reload()
      }}
    >
      Load the published version
    </Button>
  )

  return (
    <Page width="default">
      <PageHeader
        title="App config"
        description="One published configuration governs every installed app. Publishing creates a new version and retires the previous one; nothing is edited in place."
      />

      {failure?.kind === "conflict" ? (
        <Alert tone="error" title="Not published: the configuration changed" action={reloadAction}>
          Someone published a newer configuration after you opened this one, so yours was refused and
          nothing changed. Copy your edits if you need them, load the published version, apply them
          again, and publish.
        </Alert>
      ) : null}
      {failure?.kind === "unknown" ? (
        <Alert tone="warning" title="Outcome unknown" action={reloadAction}>
          The reply did not arrive, so it is not known whether this configuration was published. Check
          the published version before publishing again. Publishing the same text again is safe: it
          cannot create a second version.
        </Alert>
      ) : null}
      {failure?.kind === "rejected" ? (
        <Alert tone="error" title="Not published">
          {failure.message}
        </Alert>
      ) : null}
      {isDraftBehind && failure?.kind !== "conflict" ? (
        <Alert tone="warning" title="A newer version is published" action={reloadAction}>
          Version {String(current.version)} is now published, which is newer than the version you
          opened. Load it and apply your edits to it before publishing.
        </Alert>
      ) : null}

      <AsyncBoundary
        query={query}
        skeleton={
          <Card>
            <Skeleton height="1rem" width="35%" />
            <Skeleton height="6rem" />
          </Card>
        }
      >
        {(data) => (
          <>
            <Card elevated>
              <DataList>
                <DetailRow label="Published version">
                  {data.version === null ? "Nothing published" : String(data.version)}
                </DetailRow>
                <DetailRow label="Published at">
                  {data.publishedAt === null ? "—" : formatDateTime(data.publishedAt)}
                </DetailRow>
                <DetailRow label="Published by">{data.publishedBy ?? "—"}</DetailRow>
                <DetailRow label="Content digest">
                  <span className={ADMIN_CODE}>{data.contentSha256 ?? "—"}</span>
                </DetailRow>
              </DataList>
              {data.version === null ? (
                <p className={PROSE_SM}>
                  Nothing is published, and that is not an error. Apps fall back to their built-in
                  defaults until a configuration exists.
                </p>
              ) : null}
            </Card>

            <Section
              title="Environment"
              description="Read-only. What this build of the console is talking to."
            >
              <Card>
                <DataList>
                  <DetailRow label="API origin">{window.location.origin}</DetailRow>
                  <DetailRow label="Console target">Administrator</DetailRow>
                  <DetailRow label="Config source">
                    The published app_config_versions row with no retirement date
                  </DetailRow>
                </DataList>
              </Card>
            </Section>

            <Section
              title="Publish a new version"
              description="Accepted keys: featureFlags, minimumSupportedVersion, downloads, maintenance and presentation. Anything else is refused rather than silently dropped."
            >
              <Card>
                {canPublish ? (
                  <div className={STACK_LG}>
                    <FormField
                      label="Configuration"
                      hint="JSON. The backend applies defaults for any key you omit."
                      {...(parsed === null && draft !== null
                        ? { error: "This is not valid JSON." }
                        : {})}
                    >
                      {({ id }) => (
                        <textarea
                          id={id}
                          className={ADMIN_JSON_AREA}
                          spellCheck={false}
                          value={draft ?? ""}
                          onChange={(event) => {
                            setDraft(event.target.value)
                          }}
                        />
                      )}
                    </FormField>

                    <FormField
                      label="Reason"
                      hint="Recorded in the audit log. Not shown to investors."
                    >
                      {({ id }) => (
                        <Input
                          id={id}
                          value={reason}
                          maxLength={2_000}
                          onChange={(event) => {
                            setReason(event.target.value)
                          }}
                        />
                      )}
                    </FormField>

                    <Button
                      disabled={body === null}
                      loading={publish.isPending}
                      onClick={() => {
                        setConfirming(true)
                      }}
                      trailing
                    >
                      Publish this configuration
                    </Button>
                  </div>
                ) : (
                  <Alert tone="info" title="You can read this but not publish it">
                    Publishing configuration needs the config.publish permission.
                  </Alert>
                )}
              </Card>
            </Section>
          </>
        )}
      </AsyncBoundary>

      <ConfirmDialog
        open={confirming}
        title="Publish this configuration?"
        description="It takes effect for every installed app as soon as their config cache expires. The previous version is retired but kept."
        confirmLabel="Publish it"
        pending={publish.isPending}
        onConfirm={send}
        onCancel={() => {
          setConfirming(false)
        }}
      />
    </Page>
  )
}

export default AppConfigBuilderScreen
