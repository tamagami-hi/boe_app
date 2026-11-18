import { useState } from "react"

import { Modal } from "~/app/overlays/Modal"
import { formatDateTime } from "~/domain/dates"
import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { Button } from "~/ui/primitives/Button"
import { Form } from "~/ui/primitives/Form"
import { FormField, Input } from "~/ui/primitives/FormField"
import { ADMIN_CODE } from "~/ui/recipes/admin"
import { PROSE_SM } from "~/ui/recipes/datalist"
import { STACK_LG, STACK_SM } from "~/ui/recipes/layout"

import type { ConfigChange, VersionAbove } from "./configDraft"
import { VersionAboveRelease } from "./VersionFields"

const VALUE_PREVIEW_MAX = 120

const PATH_LABELS: Readonly<Record<string, string>> = {
  "featureFlags.onlinePayments": "Online payments in the client app",
  "minimumSupportedVersion.android": "Minimum Android version",
  "minimumSupportedVersion.ios": "Minimum iOS version",
  "minimumSupportedVersion.web": "Minimum web version",
  "minimumSupportedVersion.message": "Update message",
  "downloads.androidUrl": "Android download address",
  "downloads.iosUrl": "iOS download address",
  "maintenance.enabled": "Maintenance in progress",
  "maintenance.message": "Maintenance message",
  "maintenance.scheduledFor": "Maintenance planned start",
}

const KIND_LABELS: Readonly<Record<ConfigChange["kind"], string>> = {
  added: "added",
  removed: "removed",
  changed: "changed",
}

const preview = (path: string, value: unknown): string => {
  if (value === undefined) return "not set"
  if (typeof value === "boolean") return value ? "on" : "off"
  if (path === "maintenance.scheduledFor" && typeof value === "string" && !Number.isNaN(Date.parse(value))) {
    return `${formatDateTime(value)} India time`
  }
  const text = typeof value === "string" ? value : JSON.stringify(value)
  return text.length > VALUE_PREVIEW_MAX ? `${text.slice(0, VALUE_PREVIEW_MAX)}…` : text
}

export type PublishReviewDialogProps = Readonly<{
  open: boolean
  changes: readonly ConfigChange[]
  above: readonly VersionAbove[]
  release: string
  pending: boolean
  passwordError: string | null
  onConfirm: (password: string) => void
  onCancel: () => void
}>

export const PublishReviewDialog = ({
  open,
  changes,
  above,
  release,
  pending,
  passwordError,
  onConfirm,
  onCancel,
}: PublishReviewDialogProps): React.ReactElement | null => {
  const [password, setPassword] = useState("")
  const close = (): void => {
    setPassword("")
    onCancel()
  }
  const submit = (): void => {
    if (password === "" || pending) return
    onConfirm(password)
    setPassword("")
  }

  return (
    <Modal
      open={open}
      title="Publish these changes?"
      description="Each installed app picks up the new configuration the next time it reloads it. The previous version is retired but kept."
      onDismiss={close}
    >
      <div className={STACK_LG}>
        <div className={STACK_SM}>
          <p className={PROSE_SM}>Compared with the published version:</p>
          <DataList>
            {changes.map((change) => (
              <DetailRow key={change.path} label={`${PATH_LABELS[change.path] ?? change.path}, ${KIND_LABELS[change.kind]}`}>
                <span className={ADMIN_CODE}>{change.path}</span> {preview(change.path, change.before)} →{" "}
                {preview(change.path, change.after)}
              </DetailRow>
            ))}
          </DataList>
        </div>
        <VersionAboveRelease above={above} release={release} />
        <Form
          onSubmit={submit}
          actions={
            <>
              <Button tone="secondary" onClick={close} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" loading={pending} disabled={password === ""}>
                Publish
              </Button>
            </>
          }
        >
          <FormField
            label="Your password"
            hint="Publishing needs your password again. It is checked once and not kept."
            required
            {...(passwordError === null ? {} : { error: passwordError })}
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                name="current-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                disabled={pending}
                invalid={invalid}
                {...(describedBy === undefined ? {} : { "aria-describedby": describedBy })}
                onChange={(event) => {
                  setPassword(event.target.value)
                }}
              />
            )}
          </FormField>
        </Form>
      </div>
    </Modal>
  )
}
