import { useState } from "react"

import { Section } from "~/app/layouts/Section"
import { useSession } from "~/app/providers/SessionProvider"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { DataList, DetailRow, Prose } from "~/ui/patterns/DataList"
import { Card } from "~/ui/primitives/Card"
import { Alert, Skeleton } from "~/ui/primitives/Feedback"
import { FormField } from "~/ui/primitives/FormField"
import { Textarea } from "~/ui/primitives/Textarea"
import { Switch } from "~/ui/primitives/Toggle"
import { ADMIN_EMAIL_PREVIEW } from "~/ui/recipes/admin"
import { STACK_LG } from "~/ui/recipes/layout"

import type { AppUpdatePreview } from "./appUpdateQueries"
import { useAppUpdatePreview, useSendAppUpdate, useSendTestAppUpdate } from "./appUpdateQueries"
import { SendAction } from "./SendAction"

const MESSAGE_MAX = 500
const MESSAGE_ROWS = 3

type Release = NonNullable<AppUpdatePreview["release"]>

const AnnouncementActions = ({
  preview,
  release,
  mandatory,
  message,
}: Readonly<{ preview: AppUpdatePreview; release: Release; mandatory: boolean; message: string }>): React.ReactElement => {
  const sendAll = useSendAppUpdate()
  const sendTest = useSendTestAppUpdate()
  const request = { versionCode: release.versionCode, mandatory, ...(message === "" ? {} : { message }) }
  const audience = `${String(preview.recipientCount)} active client${preview.recipientCount === 1 ? "" : "s"}`

  return (
    <Section title="Send" description="Previewing never sends anything. Each send asks you to confirm first.">
      <div className={STACK_LG}>
        <SendAction
          label="Send a test to me"
          tone="secondary"
          disabled={false}
          confirmTitle="Send a test to your own address?"
          confirmLabel="Send the test"
          confirmBody={<Prose>The test goes only to your admin address, with [Test] in the subject. It changes no app setting.</Prose>}
          request={{ kind: "test", ...request }}
          send={async (idempotencyKey) => {
            const sent = await sendTest.mutateAsync({ ...request, idempotencyKey })
            return { title: "Test queued", detail: `Queued for ${sent.recipient}. The delivery log shows when it is sent.` }
          }}
        />
        {preview.alreadySent ? (
          <Alert tone="info" title="Already sent">
            {mandatory
              ? "A required-update email for this version was already sent to every client."
              : "An update email for this version was already sent to every client."}
          </Alert>
        ) : null}
        <SendAction
          label={`Send to all ${audience}`}
          disabled={preview.alreadySent || preview.recipientCount === 0}
          confirmTitle={`Email ${audience} about version ${release.version}?`}
          confirmLabel="Send to everyone"
          confirmBody={
            <>
              <DataList>
                <DetailRow label="Version">{release.version}</DetailRow>
                <DetailRow label="Recipients">{audience}</DetailRow>
                <DetailRow label="Kind">{mandatory ? "Required update" : "Optional update"}</DetailRow>
              </DataList>
              <Prose>
                {mandatory
                  ? `This also sets the minimum app version to ${release.version} in App configuration, so older apps will ask clients to update before they can continue. It cannot be sent twice.`
                  : "Clients can keep using their current app. This cannot be sent twice for the same version."}
              </Prose>
            </>
          }
          request={{ kind: "all", ...request }}
          send={async (idempotencyKey) => {
            const sent = await sendAll.mutateAsync({ ...request, idempotencyKey })
            return {
              title: "Announcement queued",
              detail: `Queued for ${String(sent.recipientCount)} clients.${sent.appConfigVersion === null ? "" : ` App configuration version ${String(sent.appConfigVersion)} now requires ${sent.version}.`} The delivery log shows each send.`,
            }
          }}
        />
      </div>
    </Section>
  )
}

export const AppUpdateAnnouncementPanel = (): React.ReactElement => {
  const { hasAnyPermission } = useSession()
  const canRequire = hasAnyPermission(["config.publish"])
  const [mandatory, setMandatory] = useState(false)
  const [draft, setDraft] = useState("")
  const [message, setMessage] = useState("")
  const preview = useAppUpdatePreview(mandatory, message)

  return (
    <>
      <Card>
        <div className={STACK_LG}>
          <Switch
            label="Required update"
            hint={
              canRequire
                ? "Also raises the minimum app version, so older apps ask clients to update before continuing."
                : "Needs the config.publish permission."
            }
            checked={mandatory}
            disabled={!canRequire}
            onChange={setMandatory}
          />
          <FormField label="Note to clients" hint="Optional. Plain text, shown above the download button. The preview updates when you leave this box.">
            {({ id, describedBy }) => (
              <Textarea
                id={id}
                rows={MESSAGE_ROWS}
                maxLength={MESSAGE_MAX}
                value={draft}
                aria-describedby={describedBy}
                onChange={(event) => {
                  setDraft(event.target.value)
                }}
                onBlur={() => {
                  setMessage(draft.trim())
                }}
              />
            )}
          </FormField>
        </div>
      </Card>

      <AsyncBoundary
        query={preview}
        skeleton={
          <Card>
            <Skeleton height="20rem" />
          </Card>
        }
      >
        {(data) =>
          data.release === null || data.html === null ? (
            <Alert tone="warning" title="No app to announce">
              No client app is published on this server yet, so there is nothing to announce.
            </Alert>
          ) : (
            <>
              <Section title="Preview" description="Shown exactly as clients will receive it.">
                <div className={STACK_LG}>
                  <DataList>
                    <DetailRow label="Subject">{data.subject}</DetailRow>
                    <DetailRow label="Version">{`${data.release.version} (build ${String(data.release.versionCode)})`}</DetailRow>
                    <DetailRow label="Current minimum version">{data.currentMinimum ?? "None set"}</DetailRow>
                  </DataList>
                  <iframe title="App update email preview" sandbox="" srcDoc={data.html} className={ADMIN_EMAIL_PREVIEW} />
                </div>
              </Section>
              <AnnouncementActions
                key={`${String(data.release.versionCode)}:${String(mandatory)}:${message}`}
                preview={data}
                release={data.release}
                mandatory={mandatory}
                message={message}
              />
            </>
          )
        }
      </AsyncBoundary>
    </>
  )
}
