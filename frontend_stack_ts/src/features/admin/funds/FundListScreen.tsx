import { useState } from "react"
import { Link } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { toPaise } from "~/domain/money"
import { fundState } from "~/domain/status"
import { useSession } from "~/app/providers/SessionProvider"
import { useAdminFunds } from "~/features/admin/shared/queries"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { LoadMore } from "~/ui/patterns/LoadMore"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { StatusBadge } from "~/ui/patterns/StatusBadge"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"
import { Input } from "~/ui/primitives/FormField"

import {
  ADMIN_CONTROLS,
  ADMIN_FILTER,
  ADMIN_FILTER_ROW,
  ADMIN_META,
} from "~/ui/recipes/admin"
import { ITEM_TITLE } from "~/ui/recipes/datalist"
import { CARD_COLUMNS_WRAP, ROW_BETWEEN_BASELINE } from "~/ui/recipes/layout"
import { CARD_LINK } from "~/ui/recipes/surface"
import { REFERENCE_TEXT } from "~/ui/recipes/text"

const STATES = ["draft", "published", "paused", "archived"] as const
type FundState = (typeof STATES)[number]

const FundListScreen = (): React.ReactElement => {
  const [state, setState] = useState<FundState | null>(null)
  const [search, setSearch] = useState("")
  const query = useAdminFunds({
    ...(state === null ? {} : { state }),
    ...(search.trim() === "" ? {} : { search: search.trim() }),
  })
  const { hasAllPermissions } = useSession()
  const canCreate = hasAllPermissions(["funds.write", "aum.write"])

  return (
    <Page width="wide">
      <PageHeader
        title="Funds"
        description="Create a fund with its opening AUM, publish new terms, and pause or archive it."
        actions={
          canCreate ? (
            <Link to="/funds/new">
              <Button size="sm">New fund</Button>
            </Link>
          ) : null
        }
      />

      <div className={ADMIN_CONTROLS}>
        <Input
          type="search"
          placeholder="Search by name or slug"
          aria-label="Search funds"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
          }}
        />
        <div className={ADMIN_FILTER_ROW} role="group" aria-label="Filter by state">
          <button
            type="button"
            className={ADMIN_FILTER}
            aria-pressed={state === null}
            onClick={() => {
              setState(null)
            }}
          >
            All
          </button>
          {STATES.map((option) => (
            <button
              key={option}
              type="button"
              className={ADMIN_FILTER}
              aria-pressed={state === option}
              onClick={() => {
                setState(option)
              }}
            >
              {fundState(option).label}
            </button>
          ))}
        </div>
      </div>

      <AsyncBoundary
        query={query}
        skeleton={
          <Card>
            <Skeleton height="1.1rem" width="45%" />
            <Skeleton height="1.1rem" width="60%" />
          </Card>
        }
        isEmpty={(data) => data.items.length === 0}
        empty={
          <EmptyState
            title="No fund matches"
            description="Create a fund, or clear the filters to see everything."
            action={
              canCreate ? (
                <Link to="/funds/new">
                  <Button>New fund</Button>
                </Link>
              ) : undefined
            }
          />
        }
      >
        {(data) => (
          <>
            <div className={ADMIN_META}>
              <span>{String(data.summary.total)} total</span>
              {STATES.map((option) => (
                <span key={option}>
                  {String(data.summary.byState[option])} {fundState(option).label.toLowerCase()}
                </span>
              ))}
            </div>

            <div className={CARD_COLUMNS_WRAP[3]}>
              {data.items.map((fund) => (
                <Link key={fund.id} to={`/funds/${fund.id}`} className={CARD_LINK}>
                <Card>
                  <div className={ROW_BETWEEN_BASELINE}>
                    <span className={ITEM_TITLE}>{fund.name ?? "Unnamed draft"}</span>
                    <StatusBadge status={fundState(fund.status)} />
                  </div>
                  <span className={REFERENCE_TEXT}>{fund.slug}</span>
                  <div className={ADMIN_META}>
                    <span>{fund.category ?? "No category"}</span>
                    <span>
                      {fund.currentVersion === null
                        ? "No published version"
                        : `Version ${String(fund.currentVersion)}`}
                    </span>
                    {fund.aum === null ? (
                      <span>No AUM</span>
                    ) : (
                      <span>
                        AUM <MoneyValue amount={toPaise(fund.aum.aumPaise)} size="sm" />
                      </span>
                    )}
                  </div>
                  </Card>
                </Link>
              ))}
            </div>
          </>
        )}
      </AsyncBoundary>
      <LoadMore list={query} noun="funds" />
    </Page>
  )
}

export default FundListScreen
