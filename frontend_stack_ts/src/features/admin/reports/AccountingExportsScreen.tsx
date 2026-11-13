import { useState } from "react"
import type { ReactNode } from "react"

import { isApiError } from "~/api/errors"
import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { indiaToday } from "~/features/admin/client-values/indiaToday"
import { isNative } from "~/platform/capacitor"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Alert } from "~/ui/primitives/Feedback"
import { FormField, Input } from "~/ui/primitives/FormField"
import { ADMIN_FORM_GRID } from "~/ui/recipes/admin"
import { PROSE_SM } from "~/ui/recipes/datalist"
import { ACTION_ROW } from "~/ui/recipes/layout"
import { META_TEXT } from "~/ui/recipes/text"

import { ExportStoppedError } from "./collectPages"
import { balancesCsv, contributionsCsv, saveCsvFile } from "./reportFiles"
import { useReportExports } from "./reportQueries"

type ExportState =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "running"; loaded: number }>
  | Readonly<{ kind: "failed"; message: string }>
  | Readonly<{ kind: "saved"; rows: number; fileName: string }>

type BuiltFile = Readonly<{ csv: string; rows: number }>

const failureMessage = (error: unknown): string => {
  const reason = error instanceof ExportStoppedError ? error.reason : error
  const where = error instanceof ExportStoppedError ? ` at page ${String(error.pageNumber)}` : ""
  const detail = isApiError(reason) ? ` ${reason.message}` : ""
  return `The export stopped${where}, so no file was saved.${detail} Try again when the connection is back.`
}

const useCsvExport = () => {
  const [state, setState] = useState<ExportState>({ kind: "idle" })
  const run = async (fileName: string, build: (onProgress: (loaded: number) => void) => Promise<BuiltFile>) => {
    setState({ kind: "running", loaded: 0 })
    try {
      const built = await build((loaded) => {
        setState({ kind: "running", loaded })
      })
      saveCsvFile(fileName, built.csv)
      setState({ kind: "saved", rows: built.rows, fileName })
    } catch (error) {
      setState({ kind: "failed", message: failureMessage(error) })
    }
  }
  return { state, run, isRunning: state.kind === "running" }
}

const ExportStatus = ({ state }: Readonly<{ state: ExportState }>): ReactNode => {
  if (state.kind === "running") {
    return (
      <p className={META_TEXT} role="status">
        {`Reading the ledger page by page: ${String(state.loaded)} rows so far.`}
      </p>
    )
  }
  if (state.kind === "failed") {
    return (
      <Alert tone="error" title="Export stopped">
        {state.message}
      </Alert>
    )
  }
  if (state.kind === "saved") {
    return (
      <Alert tone="success" title="File saved">
        {`${String(state.rows)} rows saved as ${state.fileName}.`}
      </Alert>
    )
  }
  return null
}

const AccountingExportsScreen = (): React.ReactElement => {
  const reports = useReportExports()
  const today = indiaToday()
  const thisMonth = today.slice(0, 7)
  const [asOfDate, setAsOfDate] = useState(today)
  const [month, setMonth] = useState(thisMonth)
  const balances = useCsvExport()
  const contributions = useCsvExport()
  const isApp = isNative()
  const isAsOfValid = asOfDate !== "" && asOfDate <= today
  const isMonthValid = month !== "" && month <= thisMonth

  const exportBalances = (): void => {
    void balances.run(`beonedge-client-balances-${asOfDate}.csv`, async (onProgress) => {
      const rows = await reports.clientBalances(asOfDate, onProgress)
      return { csv: balancesCsv(asOfDate, rows), rows: rows.length }
    })
  }

  const exportContributions = (): void => {
    void contributions.run(`beonedge-contributions-${month}.csv`, async (onProgress) => {
      const rows = await reports.monthContributions(month, onProgress)
      return { csv: contributionsCsv(rows), rows: rows.length }
    })
  }

  return (
    <Page width="wide">
      <PageHeader
        title="Accounting exports"
        description="CSV files built in this browser from the client value ledger. Each file is saved only to this device and holds client names and email addresses, so keep it private. Amounts are rupees with two decimals."
      />

      <p className={PROSE_SM}>
        An export reads the ledger page by page, so a recording or correction made while it runs can make its pages differ. Export again after the change to get a consistent file.
      </p>

      {isApp ? (
        <Alert tone="info" title="Open the console in a browser">
          The admin app cannot save files. Sign in to the admin console in a browser to download these exports.
        </Alert>
      ) : null}

      <Section
        title="Client balances as of a date"
        description="Invested and value for every client and fund at the end of the chosen India date. Only entries effective on or before it count, and a reversal is dated like the entry it reverses, so corrections recorded later are included."
      >
        <Card>
          <div className={ADMIN_FORM_GRID}>
            <FormField
              label="As of (India date)"
              error={isAsOfValid || asOfDate === "" ? undefined : "Choose today or an earlier date."}
            >
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  type="date"
                  max={today}
                  value={asOfDate}
                  invalid={invalid}
                  aria-describedby={describedBy}
                  onChange={(event) => {
                    setAsOfDate(event.target.value)
                  }}
                />
              )}
            </FormField>
          </div>
          <ExportStatus state={balances.state} />
          <div className={ACTION_ROW}>
            <Button loading={balances.isRunning} disabled={isApp || !isAsOfValid || balances.isRunning} onClick={exportBalances}>
              Download balances CSV
            </Button>
          </div>
        </Card>
      </Section>

      <Section
        title="Contributions by month"
        description="Every investment entry whose effective date falls in the chosen month, with its category, the time it was recorded and whether it was later reversed."
      >
        <Card>
          <div className={ADMIN_FORM_GRID}>
            <FormField label="Month" error={isMonthValid || month === "" ? undefined : "Choose this month or an earlier one."}>
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  type="month"
                  max={thisMonth}
                  value={month}
                  invalid={invalid}
                  aria-describedby={describedBy}
                  onChange={(event) => {
                    setMonth(event.target.value)
                  }}
                />
              )}
            </FormField>
          </div>
          <ExportStatus state={contributions.state} />
          <div className={ACTION_ROW}>
            <Button
              loading={contributions.isRunning}
              disabled={isApp || !isMonthValid || contributions.isRunning}
              onClick={exportContributions}
            >
              Download contributions CSV
            </Button>
          </div>
          <p className={PROSE_SM}>
            Recorded investments carry the category chosen when they were recorded. Online payments read One-off investment or SIP instalment.
          </p>
          <p className={PROSE_SM}>
            A reversed entry still shows its original amount, marked Reversed with the time of the reversal. Its reversal is dated the same day, so it adds nothing to the month.
          </p>
        </Card>
      </Section>
    </Page>
  )
}

export default AccountingExportsScreen
