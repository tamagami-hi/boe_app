import { Button } from "~/ui/primitives/Button"
import { Alert } from "~/ui/primitives/Feedback"
import { ACTION_ROW, ROW_BETWEEN_BASELINE, STACK_LG, STACK_SM } from "~/ui/recipes/layout"
import { BLOCK_PROGRESS_FILL, BLOCK_PROGRESS_TRACK } from "~/ui/recipes/overlay"
import { HONESTY_TEXT, LABEL_TEXT, META_MUTED } from "~/ui/recipes/text"

import type { UpdateRelease } from "./updateDecision"
import type { UpdateInstaller } from "./useUpdateInstaller"

export const VERIFICATION_NOTE =
  "Every update is checked before it is installed. Anything that does not match what BeOnEdge published is discarded."

const MEGABYTE = 1_048_576

const sizeLabel = (sizeBytes: number): string =>
  sizeBytes <= 0 ? "Size unavailable" : `${(sizeBytes / MEGABYTE).toFixed(1)} MB`

export type UpdateInstallPanelProps = Readonly<{
  release: UpdateRelease
  installer: UpdateInstaller
}>

export const UpdateInstallPanel = ({
  release,
  installer,
}: UpdateInstallPanelProps): React.ReactElement => {
  const { state } = installer
  const percent = state.phase === "downloading" ? state.percent : null

  return (
    <div className={STACK_LG}>
      <div className={STACK_SM}>
        <div className={ROW_BETWEEN_BASELINE}>
          <span className={LABEL_TEXT}>Version</span>
          <span className={META_MUTED}>{release.versionName}</span>
        </div>
        <div className={ROW_BETWEEN_BASELINE}>
          <span className={LABEL_TEXT}>Download</span>
          <span className={META_MUTED}>{sizeLabel(release.sizeBytes)}</span>
        </div>
      </div>

      {state.phase === "downloading" ? (
        <div className={STACK_SM}>
          <div
            className={BLOCK_PROGRESS_TRACK}
            role="progressbar"
            aria-label="Downloading the update"
            {...(percent === null
              ? {}
              : { "aria-valuenow": percent, "aria-valuemin": 0, "aria-valuemax": 100 })}
          >
            <span
              className={BLOCK_PROGRESS_FILL}
              style={{ transform: `scaleX(${String((percent ?? 0) / 100)})` }}
            />
          </div>
          <span className={META_MUTED}>
            {percent === null ? "Downloading…" : `Downloading… ${String(percent)}%`}
          </span>
        </div>
      ) : null}

      {state.phase === "failed" ? (
        <Alert tone="error" title="Update not installed">
          {state.message}
        </Alert>
      ) : null}

      {state.phase === "needs-permission" ? (
        <Alert tone="warning" title="One permission needed">
          {state.settingsOpened
            ? "Allow BeOnEdge to install apps in the settings screen that just opened, then come back and choose Install."
            : "Android needs your permission to install this update. We will take you to the setting."}
        </Alert>
      ) : null}

      <div className={ACTION_ROW}>
        {state.phase === "idle" || state.phase === "failed" ? (
          <Button onClick={installer.start}>
            {state.phase === "failed" ? "Try again" : "Download update"}
          </Button>
        ) : null}
        {state.phase === "downloading" || state.phase === "installing" ? (
          <Button loading disabled>
            {state.phase === "installing" ? "Opening installer" : "Downloading"}
          </Button>
        ) : null}
        {state.phase === "ready" ? <Button onClick={installer.install}>Install now</Button> : null}
        {state.phase === "needs-permission" ? (
          <>
            <Button onClick={installer.allowInstalls}>Open settings</Button>
            <Button tone="secondary" onClick={installer.install}>
              I have allowed it
            </Button>
          </>
        ) : null}
      </div>

      <p className={HONESTY_TEXT}>{VERIFICATION_NOTE}</p>
    </div>
  )
}
