import { useState } from "react"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { FilterChip, FilterRow } from "~/features/admin/shared/AdminTable"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { LoadMore } from "~/ui/patterns/LoadMore"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"
import { FormField, Input } from "~/ui/primitives/FormField"
import { ADMIN_CONTROLS } from "~/ui/recipes/admin"

import { useAuditTrail, type AuditPreset } from "./auditQueries"
import { AuditTrailTable } from "./AuditTrailTable"

const PRESETS: readonly Readonly<{ value: AuditPreset | null; label: string }>[] = [
  { value: null, label: "All events" },
  { value: "recordings", label: "Recordings" },
  { value: "reversals", label: "Reversals" },
  { value: "growth", label: "Value updates" },
  { value: "maturity", label: "Maturities" },
  { value: "refunds", label: "Refunds" },
]

type TextFilters = Readonly<{ entityType: string; command: string }>

const AuditLogScreen = (): React.ReactElement => {
  const [preset, setPreset] = useState<AuditPreset | null>(null)
  const [fromDate, setFromDate] = useState("")
  const [toDate, setToDate] = useState("")
  const [draft, setDraft] = useState<TextFilters>({ entityType: "", command: "" })
  const [applied, setApplied] = useState<TextFilters>({ entityType: "", command: "" })
  const rangeError = fromDate !== "" && toDate !== "" && fromDate > toDate ? "The end date is before the start date." : undefined
  const query = useAuditTrail({
    preset,
    entityType: applied.entityType,
    command: applied.command,
    fromDate: rangeError === undefined ? fromDate : "",
    toDate: rangeError === undefined ? toDate : "",
  })

  const apply = (): void => {
    setApplied({ entityType: draft.entityType.trim(), command: draft.command.trim() })
  }

  const textInput = (field: keyof TextFilters, placeholder: string, label: string): React.ReactElement => (
    <Input
      type="search"
      placeholder={placeholder}
      aria-label={label}
      value={draft[field]}
      onChange={(event) => {
        setDraft({ ...draft, [field]: event.target.value })
      }}
      onBlur={apply}
      onKeyDown={(event) => {
        if (event.key === "Enter") apply()
      }}
    />
  )

  return (
    <Page width="wide">
      <PageHeader
        title="Audit log"
        description="Every administrative command, who ran it, what it touched and which request it belonged to. Money commands show the client and amount the audit record names. Filters search the whole log, not just the page in front of you. Dates are India dates."
      />

      <FilterRow label="Show">
        {PRESETS.map((option) => (
          <FilterChip
            key={option.label}
            active={option.value === preset}
            label={option.label}
            onSelect={() => {
              setPreset(option.value)
            }}
          />
        ))}
      </FilterRow>

      <div className={ADMIN_CONTROLS}>
        <FormField label="From">
          {({ id }) => (
            <Input
              id={id}
              type="date"
              value={fromDate}
              onChange={(event) => {
                setFromDate(event.target.value)
              }}
            />
          )}
        </FormField>
        <FormField label="To" error={rangeError}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type="date"
              value={toDate}
              invalid={invalid}
              aria-describedby={describedBy}
              onChange={(event) => {
                setToDate(event.target.value)
              }}
            />
          )}
        </FormField>
        {textInput("entityType", "Entity type, for example content_item", "Filter by entity type")}
        {textInput("command", "Command, for example user.suspended", "Filter by command")}
      </div>

      <AsyncBoundary
        query={query}
        skeleton={
          <Card>
            <Skeleton height="1rem" width="45%" />
            <Skeleton height="1rem" width="70%" />
          </Card>
        }
        isEmpty={(data) => data.items.length === 0}
        empty={<EmptyState title="No audit entry matches" description="Clear the filters to see the whole log." />}
      >
        {(data) => <AuditTrailTable caption="Audit log, newest first" rows={data.items} showClient />}
      </AsyncBoundary>
      <LoadMore list={query} noun="audit events" />
    </Page>
  )
}

export default AuditLogScreen
