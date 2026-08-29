import { useMemo, useState } from "react"
import { Link } from "react-router-dom"

import { isCompact, useBreakpoint } from "~/lib/useBreakpoint"
import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { ContentGrid } from "~/app/layouts/ContentGrid"
import { fundRiskLevel } from "~/domain/status"
import { toPaise } from "~/domain/money"
import { useFunds } from "~/features/shared/queries"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { StatusBadge } from "~/ui/patterns/StatusBadge"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"
import { Input } from "~/ui/primitives/FormField"
import { CARD_LINK } from "~/ui/recipes/surface"

import { FundTable } from "./FundTable"
import { FUND_CARD_TOP, FUND_CONTROLS, FUND_SIZE_ROW, FUND_SORT_BUTTON, FUND_SORT_GROUP } from "./funds.recipe"
import { ITEM_TITLE } from "~/ui/recipes/datalist"
import { META_MUTED } from "~/ui/recipes/text"

const SORTS = ["name", "risk", "size"] as const
type Sort = (typeof SORTS)[number]

const FundListScreen = (): React.ReactElement => {
  const query = useFunds()
  const breakpoint = useBreakpoint()
  const compact = isCompact(breakpoint)
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState<Sort>("name")

  const skeleton = useMemo(
    () => (
      <ContentGrid columns={3}>
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <Card key={index}>
            <Skeleton height="1.2rem" width="70%" />
            <Skeleton height="0.9rem" width="40%" />
            <Skeleton height="2rem" width="55%" />
          </Card>
        ))}
      </ContentGrid>
    ),
    [],
  )

  return (
    <Page width="default">
      <PageHeader
        title="Funds"
        description="Administrator-managed pools. Every figure here is served by the backend; nothing is computed on this device."
      />

      <div className={FUND_CONTROLS}>
        <Input
          type="search"
          placeholder="Search by name or category"
          aria-label="Search funds"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
          }}
        />
        {!compact ? null : (
          <div className={FUND_SORT_GROUP} role="group" aria-label="Sort funds">
            {SORTS.map((option) => (
              <button
                key={option}
                type="button"
                className={FUND_SORT_BUTTON}
                aria-pressed={option === sort}
                onClick={() => {
                  setSort(option)
                }}
              >
                {option === "name" ? "Name" : option === "risk" ? "Risk" : "Size"}
              </button>
            ))}
          </div>
        )}
      </div>

      <AsyncBoundary
        query={query}
        skeleton={skeleton}
        isEmpty={(data) => data.items.length === 0}
        empty={
          <EmptyState
            title="No funds are published yet"
            description="When an administrator publishes a fund it appears here."
          />
        }
      >
        {(data) => {
          const term = search.trim().toLowerCase()
          const filtered = data.items.filter(
            (fund) =>
              term === "" ||
              fund.name.toLowerCase().includes(term) ||
              fund.category.toLowerCase().includes(term),
          )
          const riskOrder = { low: 0, moderate: 1, high: 2, very_high: 3 } as const
          const sorted = [...filtered].sort((left, right) => {
            if (sort === "name") return left.name.localeCompare(right.name)
            if (sort === "risk") return riskOrder[left.riskLevel] - riskOrder[right.riskLevel]
            const leftSize = BigInt(left.fundSize?.aumPaise ?? "0")
            const rightSize = BigInt(right.fundSize?.aumPaise ?? "0")
            return leftSize === rightSize ? 0 : leftSize > rightSize ? -1 : 1
          })

          if (sorted.length === 0) {
            return (
              <EmptyState
                title="No fund matches that search"
                description="Clear the search to see every published fund."
              />
            )
          }

          if (!compact) {
            return <FundTable rows={sorted} sort={sort} onSort={setSort} />
          }

          return (
            <ContentGrid columns={2}>
              {sorted.map((fund) => (
                <Link key={fund.id} to={`/funds/${fund.id}`} className={CARD_LINK}>
                  <Card>
                    <div className={FUND_CARD_TOP}>
                      <span className={ITEM_TITLE}>{fund.name}</span>
                      <StatusBadge status={fundRiskLevel(fund.riskLevel)} />
                    </div>
                    <span className={META_MUTED}>{fund.category}</span>
                    {fund.fundSize === null ? (
                      <span className={META_MUTED}>Fund size not published</span>
                    ) : (
                      <div className={FUND_SIZE_ROW}>
                        <span className={META_MUTED}>Fund size</span>
                        <MoneyValue amount={toPaise(fund.fundSize.aumPaise)} size="lg" />
                      </div>
                    )}
                    <span className={META_MUTED}>
                      {fund.stockCount === 0
                        ? "Holdings not disclosed"
                        : `${String(fund.stockCount)} disclosed holdings`}
                    </span>
                  </Card>
                </Link>
              ))}
            </ContentGrid>
          )
        }}
      </AsyncBoundary>
    </Page>
  )
}

export default FundListScreen
