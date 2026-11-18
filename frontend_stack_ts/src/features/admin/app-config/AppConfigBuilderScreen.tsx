import { useEffect, useState } from "react"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { useSession } from "~/app/providers/SessionProvider"
import { formatDateTime } from "~/domain/dates"
import { buildVersion, ConfigurationError, resolveApiBase } from "~/lib/env"
import { useHeldDone } from "~/features/admin/shared/useHeldDone"
import { HeldWriteNotice } from "~/features/admin/shared/HeldWriteNotice"
import { useHeldWrite } from "~/features/admin/shared/useHeldWrite"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"

import { ADMIN_CODE } from "~/ui/recipes/admin"
import { PROSE_SM } from "~/ui/recipes/datalist"

import { AdvancedJson } from "./AdvancedJson"
import { ConfigFields } from "./ConfigFields"
import type { AdminAppConfig } from "./appConfigQueries"
import { useAdminAppConfig, useConfirmPublishPassword, usePublishAppConfig } from "./appConfigQueries"
import { draftOf, parseDraft, serialise, type JsonRecord } from "./configDraft"
import { checkDraft } from "./draftChecks"
import { describeConfirmFailure, describePublishRefusal } from "./publishFailures"
import { PublishPanel } from "./PublishPanel"
import { PublishReviewDialog } from "./PublishReviewDialog"

const UNSENT = "The configuration could not be sent. Reload the page and try again."

const apiAddress = (): string => {
  try {
    return resolveApiBase()
  } catch (error) {
    if (error instanceof ConfigurationError) return "Not configured in this build"
    throw error
  }
}

const AppConfigBuilderScreen = (): React.ReactElement => {
  const query = useAdminAppConfig()
  const publish = useHeldWrite(usePublishAppConfig(), UNSENT)
  const confirm = useConfirmPublishPassword()
  const { hasAnyPermission } = useSession()
  const [draft, setDraft] = useState<JsonRecord | null>(null)
  const [basis, setBasis] = useState<JsonRecord | null>(null)
  const [jsonText, setJsonText] = useState("")
  const [isJsonObject, setIsJsonObject] = useState(true)
  const [editedFrom, setEditedFrom] = useState<number | null | undefined>(undefined)
  const [reason, setReason] = useState("")
  const [reviewing, setReviewing] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [localFailure, setLocalFailure] = useState<string | null>(null)
  const [isReloading, setIsReloading] = useState(false)

  const { outcome } = publish
  const isLocked = publish.held !== null
  const canPublish = hasAnyPermission(["config.publish"])
  const current = query.data ?? null
  const release = buildVersion()
  const checks = checkDraft(isJsonObject ? draft : null, basis, release)
  const refusal = describePublishRefusal(outcome)
  const isConflict = refusal?.kind === "conflict"
  const isDraftBehind = editedFrom !== undefined && current !== null && current.version !== editedFrom

  const loadFrom = (data: AdminAppConfig): void => {
    const next = draftOf(data.config)
    setBasis(data.config)
    setDraft(next)
    setJsonText(serialise(next))
    setIsJsonObject(true)
    setEditedFrom(data.version)
  }

  const editForm = (next: JsonRecord): void => {
    setDraft(next)
    setJsonText(serialise(next))
    setIsJsonObject(true)
  }

  const editJson = (text: string): void => {
    setJsonText(text)
    const parsed = parseDraft(text)
    setIsJsonObject(parsed !== null)
    if (parsed !== null) setDraft(parsed)
  }

  useEffect(() => {
    if (draft !== null || current === null) return
    loadFrom(current)
  }, [current, draft])

  useHeldDone(outcome, (published) => {
    setReason("")
    loadFrom(published)
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
    loadFrom(result.data)
  }

  const confirmAndPublish = (password: string): void => {
    setPasswordError(null)
    setLocalFailure(null)
    if (checks.payload === null || editedFrom === undefined || !checks.isPublishable) return
    const trimmedReason = reason.trim()
    const reviewed = { config: checks.payload, expectedVersion: editedFrom }
    const body = { ...reviewed, ...(trimmedReason === "" ? {} : { reason: trimmedReason }) }
    confirm.mutate({ password, body: reviewed }, {
      onSuccess: (issued) => {
        setReviewing(false)
        publish.submit({ ...body, confirmation: issued.confirmation })
      },
      onError: (error) => {
        setPasswordError(describeConfirmFailure(error))
      },
    })
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
      {refusal?.kind === "message" ? (
        <Alert tone="error" title="Not published">
          {refusal.text}
        </Alert>
      ) : null}
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

            <Section title="Environment" description="Read-only. What this build of the console is talking to.">
              <Card>
                <DataList>
                  <DetailRow label="API address">{apiAddress()}</DetailRow>
                  <DetailRow label="Console target">Administrator</DetailRow>
                  <DetailRow label="Config source">The latest published version, shown above</DetailRow>
                </DataList>
              </Card>
            </Section>

            {canPublish ? null : (
              <Alert tone="info" title="You can read this but not publish it">
                Your role cannot publish configuration.
              </Alert>
            )}

            {draft === null ? null : (
              <ConfigFields
                draft={draft}
                disabled={!canPublish || isLocked || !isJsonObject}
                onChange={editForm}
                problems={checks.problems}
                above={checks.above}
                release={release}
              />
            )}

            <Card>
              <AdvancedJson text={jsonText} isObject={isJsonObject} disabled={!canPublish || isLocked} onText={editJson} />
            </Card>

            {canPublish ? (
              <PublishPanel
                reason={reason}
                onReason={setReason}
                checks={checks}
                isJsonObject={isJsonObject}
                disabled={isLocked || editedFrom === undefined}
                pending={publish.pending}
                onReview={() => {
                  setPasswordError(null)
                  setReviewing(true)
                }}
              />
            ) : null}
          </>
        )}
      </AsyncBoundary>

      <PublishReviewDialog
        open={reviewing}
        changes={checks.changes}
        above={checks.above}
        release={release}
        pending={confirm.isPending}
        passwordError={passwordError}
        onConfirm={confirmAndPublish}
        onCancel={() => {
          setReviewing(false)
          setPasswordError(null)
        }}
      />
    </Page>
  )
}

export default AppConfigBuilderScreen
