import type { DraftEditorProps, FieldProblems, VersionAbove } from "./configDraft"
import { DownloadFields } from "./DownloadFields"
import { FlagFields } from "./FlagFields"
import { MaintenanceFields } from "./MaintenanceFields"
import { PresentationFields } from "./PresentationFields"
import { VersionFields } from "./VersionFields"

export type ConfigFieldsProps = DraftEditorProps &
  Readonly<{ problems: FieldProblems; above: readonly VersionAbove[]; release: string }>

export const ConfigFields = ({ draft, disabled, onChange, problems, above, release }: ConfigFieldsProps): React.ReactElement => {
  const editor = { draft, disabled, onChange }
  return (
    <>
      <FlagFields {...editor} />
      <VersionFields {...editor} problems={problems} above={above} release={release} />
      <DownloadFields {...editor} problems={problems} />
      <MaintenanceFields {...editor} />
      <PresentationFields {...editor} />
    </>
  )
}
