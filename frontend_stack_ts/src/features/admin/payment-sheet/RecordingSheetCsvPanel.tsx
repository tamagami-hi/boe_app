import { useState } from "react"

import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert } from "~/ui/primitives/Feedback"
import { FormField } from "~/ui/primitives/FormField"
import { Textarea } from "~/ui/primitives/Textarea"
import { STACK_LG, STACK_SM } from "~/ui/recipes/layout"

import type { CsvMatch } from "./recordingSheetCsv"

export type RecordingSheetCsvPanelProps = Readonly<{
  disabled: boolean
  onFill: (text: string) => CsvMatch
}>

const CSV_HINT =
  "One payment per line: the client's email, the client id or the schedule id, then the amount in rupees, then an optional date as YYYY-MM-DD. Commas or tabs both work. Filling only ticks and fills rows; nothing is sent until you press Record."

export const RecordingSheetCsvPanel = ({ disabled, onFill }: RecordingSheetCsvPanelProps): React.ReactElement => {
  const [text, setText] = useState("")
  const [result, setResult] = useState<CsvMatch | null>(null)

  return (
    <Card>
      <div className={STACK_LG}>
        <FormField label="Paste rows" hint={CSV_HINT}>
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              rows={5}
              value={text}
              disabled={disabled}
              onChange={(event) => {
                setText(event.target.value)
                setResult(null)
              }}
            />
          )}
        </FormField>
        <Button
          tone="secondary"
          disabled={disabled || text.trim() === ""}
          onClick={() => {
            setResult(onFill(text))
          }}
        >
          Fill the sheet
        </Button>
        {result === null ? null : (
          <div className={STACK_SM}>
            <Alert tone={result.fills.length > 0 ? "success" : "info"} title="Sheet filled">
              {`${String(result.fills.length)} row(s) filled and ticked. Check them, then press Record.`}
            </Alert>
            {result.problems.length === 0 ? null : (
              <Alert tone="warning" title={`${String(result.problems.length)} line(s) not used`}>
                <ul className={STACK_SM}>
                  {result.problems.map((problem) => (
                    <li key={problem.line}>{`Line ${String(problem.line)} (${problem.text}): ${problem.reason}`}</li>
                  ))}
                </ul>
              </Alert>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}
