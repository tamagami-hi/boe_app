import { useEffect, useState } from "react"

import { isApiError } from "~/api/errors"
import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { ConfirmDialog } from "~/app/overlays/ConfirmDialog"
import { useSession } from "~/app/providers/SessionProvider"
import { formatDateTime } from "~/domain/dates"
import { useAdminAppConfig, usePublishAppConfig } from "~/features/admin/shared/adminQueries"
import type { AppConfigInput } from "~/features/admin/shared/adminQueries"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"
import { FormField, Input } from "~/ui/primitives/FormField"

import styles from "~/features/admin/shared/Admin.module.css"

const TEMPLATE = {
  featureFlags: {},
  minimumSupportedVersion: {},
  downloads: {},
  maintenance: { enabled: false },
  presentation: {},
} as const

const AppConfigBuilderScreen = (): React.ReactElement => {
  const query = useAdminAppConfig()
  const publish = usePublishAppConfig()
  const { hasAnyPermission } = useSession()
  const [draft, setDraft] = useState<string | null>(null)
  const [reason, setReason] = useState("")
  const [confirming, setConfirming] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const canPublish = hasAnyPermission(["config.publish"])
  const current = query.data ?? null

  useEffect(() => {
    if (draft !== null || current === null) return
    setDraft(JSON.stringify(current.config ?? TEMPLATE, null, 2))
  }, [current, draft])

  const parsed = ((): AppConfigInput | null => {
    if (draft === null) return null
    try {
      const value: unknown = JSON.parse(draft)
      if (typeof value !== "object" || value === null || Array.isArray(value)) return null
      return { config: value }
    } catch {
      return null
    }
  })()

  const send = (): void => {
    setFailure(null)
    if (parsed === null) {
      setFailure("That is not a JSON object. Fix the syntax before publishing.")
      setConfirming(false)
      return
    }
    publish.mutate(
      { ...parsed, ...(reason.trim() === "" ? {} : { reason: reason.trim() }) },
      {
        onError: (error) => {
          setFailure(
            isApiError(error)
              ? error.code === "VALIDATION_FAILED"
                ? "The backend refused that configuration. Only the documented keys are accepted, and the version strings must be dotted numbers."
                : error.message
              : "We could not publish that. The live configuration is unchanged.",
          )
        },
        onSuccess: () => {
          setReason("")
        },
        onSettled: () => {
          setConfirming(false)
        },
      },
    )
  }

  return (
    <Page width="default">
      <PageHeader
        title="App config"
        description="One published configuration governs every installed app. Publishing creates a new version and retires the previous one; nothing is edited in place."
      />

      {failure === null ? null : (
        <Alert tone="error" title="Not published">
          {failure}
        </Alert>
      )}

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
                  <span className={styles.code}>{data.contentSha256 ?? "—"}</span>
                </DetailRow>
              </DataList>
              {data.version === null ? (
                <p className={styles.note}>
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
                  <div className={styles.form}>
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
                          className={styles.jsonArea}
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
                      disabled={parsed === null}
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
