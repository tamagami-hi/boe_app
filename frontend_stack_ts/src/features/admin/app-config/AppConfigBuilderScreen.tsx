import { useEffect, useState } from "react"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { useSession } from "~/app/providers/SessionProvider"
import { formatDateTime } from "~/domain/dates"
import { useHeldDone } from "~/features/admin/shared/useHeldDone"
import { HeldWriteNotice } from "~/features/admin/shared/HeldWriteNotice"
import { useHeldWrite } from "~/features/admin/shared/useHeldWrite"
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

const UNSENT = "The configuration could not be sent. Reload the page and try again."

const VALIDATION_MESSAGE =
  "The backend refused that configuration. Only the documented keys are accepted, and the version strings must be dotted numbers."

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
  const publish = useHeldWrite(usePublishAppConfig(), UNSENT)
  const { hasAnyPermission } = useSession()
  const [draft, setDraft] = useState<string | null>(null)
  const [editedFrom, setEditedFrom] = useState<number | null | undefined>(undefined)
  const [reason, setReason] = useState("")
  const [confirming, setConfirming] = useState(false)
  const [localFailure, setLocalFailure] = useState<string | null>(null)
  const [isReloading, setIsReloading] = useState(false)

  const { outcome } = publish
  const isLocked = publish.held !== null
  const canPublish = hasAnyPermission(["config.publish"])
  const current = query.data ?? null
  const parsed = parseDraft(draft)
  const trimmedReason = reason.trim()
  const body: AppConfigInput | null =
    parsed === null || editedFrom === undefined
      ? null
      : { ...parsed, expectedVersion: editedFrom, ...(trimmedReason === "" ? {} : { reason: trimmedReason }) }
  const isDraftBehind = editedFrom !== undefined && current !== null && current.version !== editedFrom
  const isConflict = outcome.kind === "rejected" && outcome.code === "STATE_CONFLICT"
  const rejection =
    outcome.kind !== "rejected" || isConflict
      ? null
      : outcome.code === "VALIDATION_FAILED"
        ? VALIDATION_MESSAGE
        : outcome.message

  useEffect(() => {
    if (draft !== null || current === null) return
    setDraft(draftOf(current))
    setEditedFrom(current.version)
  }, [current, draft])

  useHeldDone(outcome, (published) => {
    setReason("")
    setDraft(draftOf(published))
    setEditedFrom(published.version)
  })

  const reload = async (): Promise<void> => {
    if (isLocked) return
    setIsReloading(true)
    const result = await query.refetch()
    setIsReloading(false)
    if (result.isError || result.data === undefined) {
      setLocalFailure("The published configuration could not be loaded. Try again.")
      return
    }
    setLocalFailure(null)
    publish.reset()
    setDraft(draftOf(result.data))
    setEditedFrom(result.data.version)
  }

  const send = (): void => {
    setConfirming(false)
    setLocalFailure(null)
    if (body === null) {
      setLocalFailure("That is not a JSON object. Fix the syntax before publishing.")
      return
    }
    publish.submit(body)
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

      {isConflict ? (
        <Alert tone="error" title="Not published: the configuration changed" action={reloadAction}>
          Someone published a newer configuration after you opened this one, so yours was refused and
          nothing changed. Copy your edits if you need them, load the published version, apply them
          again, and publish.
        </Alert>
      ) : null}
      {outcome.kind === "unknown" ? (
        <HeldWriteNotice
          write={publish}
          subject="this configuration was published"
          onReload={() => {
            void query.refetch()
          }}
          reloadLabel="Reload the published version"
        />
      ) : null}
      {rejection === null ? null : (
        <Alert tone="error" title="Not published">
          {rejection}
        </Alert>
      )}
      {localFailure === null ? null : (
        <Alert tone="error" title="Not published">
          {localFailure}
        </Alert>
      )}
      {isDraftBehind && !isConflict && !isLocked ? (
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
                          disabled={isLocked}
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
                          disabled={isLocked}
                          value={reason}
                          maxLength={2_000}
                          onChange={(event) => {
                            setReason(event.target.value)
                          }}
                        />
                      )}
                    </FormField>

                    <Button
                      disabled={body === null || isLocked}
                      loading={publish.pending}
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
                    Your role cannot publish configuration.
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
        cancelLabel="Cancel"
        onConfirm={send}
        onCancel={() => {
          setConfirming(false)
        }}
      />
    </Page>
  )
}

export default AppConfigBuilderScreen
