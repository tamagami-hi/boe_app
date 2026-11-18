import { Section } from "~/app/layouts/Section"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert } from "~/ui/primitives/Feedback"
import { FormField, Input } from "~/ui/primitives/FormField"
import { PROSE_SM } from "~/ui/recipes/datalist"
import { STACK_LG } from "~/ui/recipes/layout"

import type { DraftChecks } from "./draftChecks"

const REASON_MAX = 2_000

export type PublishPanelProps = Readonly<{
  reason: string
  onReason: (next: string) => void
  checks: DraftChecks
  isJsonObject: boolean
  disabled: boolean
  pending: boolean
  onReview: () => void
}>

const blockerOf = (checks: DraftChecks, isJsonObject: boolean): string | null => {
  if (!isJsonObject) return "Fix the Advanced JSON first. The form keeps the last valid configuration until then."
  if (Object.keys(checks.problems).length > 0) return "Fix the fields marked above first."
  if (checks.refusals.length > 0) return null
  if (checks.changes.length === 0) return "Nothing differs from the published version yet."
  return null
}

export const PublishPanel = ({
  reason,
  onReason,
  checks,
  isJsonObject,
  disabled,
  pending,
  onReview,
}: PublishPanelProps): React.ReactElement => {
  const blocker = blockerOf(checks, isJsonObject)
  return (
    <Section
      title="Publish"
      description="Publishing replaces the whole configuration. A key you leave out is cleared, and maintenance is off unless you turn it on."
    >
      <Card>
        <div className={STACK_LG}>
          {isJsonObject && checks.refusals.length > 0 ? (
            <Alert tone="error" title="This configuration would be refused">
              {checks.refusals.join(" · ")}
            </Alert>
          ) : null}
          <FormField label="Reason" hint="Recorded in the audit log. Not shown to investors.">
            {({ id, describedBy }) => (
              <Input
                id={id}
                disabled={disabled}
                value={reason}
                maxLength={REASON_MAX}
                {...(describedBy === undefined ? {} : { "aria-describedby": describedBy })}
                onChange={(event) => {
                  onReason(event.target.value)
                }}
              />
            )}
          </FormField>
          {blocker === null ? null : <p className={PROSE_SM}>{blocker}</p>}
          <div>
            <Button disabled={disabled || !checks.isPublishable} loading={pending} onClick={onReview} trailing>
              Review and publish
            </Button>
          </div>
        </div>
      </Card>
    </Section>
  )
}
