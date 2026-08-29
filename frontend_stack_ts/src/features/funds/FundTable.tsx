import { Link } from "react-router-dom"

import { toPaise } from "~/domain/money"
import { cx } from "~/lib/cx"
import { fundRiskLevel } from "~/domain/status"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { StatusBadge } from "~/ui/patterns/StatusBadge"
import { SHELL } from "~/ui/recipes/surface"

import { FUND_SORT_GLYPH, FUND_TABLE, FUND_TABLE_CELL, FUND_TABLE_HEAD_BUTTON, FUND_TABLE_HEAD_CELL, FUND_TABLE_HEAD_LABEL, FUND_TABLE_INNER, FUND_TABLE_MUTED, FUND_TABLE_NAME, FUND_TABLE_NAME_LINK, FUND_TABLE_ROW } from "./funds.recipe"
import { ADMIN_NUMERIC } from "~/ui/recipes/admin"
import { META_MUTED } from "~/ui/recipes/text"

export type FundRow = Readonly<{
  id: string
  name: string
  category: string
  riskLevel: "low" | "moderate" | "high" | "very_high"
  stockCount: number
  fundSize: Readonly<{ aumPaise: string }> | null
}>

export type FundSort = "name" | "risk" | "size"

export type FundTableProps = Readonly<{
  rows: readonly FundRow[]
  sort: FundSort
  onSort: (next: FundSort) => void
}>

const SortGlyph = (): React.ReactElement => (
  <svg
    className={FUND_SORT_GLYPH}
    viewBox="0 0 9 9"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.3"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="M1.6 3.4 4.5 0.6l2.9 2.8" />
  </svg>
)

export const FundTable = ({ rows, sort, onSort }: FundTableProps): React.ReactElement => (
  <div className={SHELL}>
    <div className={FUND_TABLE_INNER}>
      <table className={FUND_TABLE}>
        <thead>
          <tr>
            <th scope="col" className={FUND_TABLE_HEAD_CELL}>
              <button
                type="button"
                className={FUND_TABLE_HEAD_BUTTON}
                aria-pressed={sort === "name"}
                onClick={() => {
                  onSort("name")
                }}
              >
                Fund
                {sort === "name" ? <SortGlyph /> : null}
              </button>
            </th>
            <th scope="col" className={FUND_TABLE_HEAD_CELL}>
              <button
                type="button"
                className={FUND_TABLE_HEAD_BUTTON}
                aria-pressed={sort === "risk"}
                onClick={() => {
                  onSort("risk")
                }}
              >
                Risk
                {sort === "risk" ? <SortGlyph /> : null}
              </button>
            </th>
            <th scope="col" className={cx(FUND_TABLE_HEAD_CELL, ADMIN_NUMERIC)}>
              <button
                type="button"
                className={FUND_TABLE_HEAD_BUTTON}
                aria-pressed={sort === "size"}
                onClick={() => {
                  onSort("size")
                }}
              >
                Fund size
                {sort === "size" ? <SortGlyph /> : null}
              </button>
            </th>
            <th scope="col" className={cx(FUND_TABLE_HEAD_CELL, ADMIN_NUMERIC)}>
              <span className={FUND_TABLE_HEAD_LABEL}>Holdings</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((fund) => (
            <tr key={fund.id} className={FUND_TABLE_ROW}>
              <td className={FUND_TABLE_CELL}>
                <Link to={`/funds/${fund.id}`} className={FUND_TABLE_NAME_LINK}>
                  <span className={FUND_TABLE_NAME}>{fund.name}</span>
                  <span className={META_MUTED}>{fund.category}</span>
                </Link>
              </td>
              <td className={FUND_TABLE_CELL}>
                <StatusBadge status={fundRiskLevel(fund.riskLevel)} />
              </td>
              <td className={cx(FUND_TABLE_CELL, ADMIN_NUMERIC)}>
                {fund.fundSize === null ? (
                  <span className={FUND_TABLE_MUTED}>Not published</span>
                ) : (
                  <MoneyValue amount={toPaise(fund.fundSize.aumPaise)} size="md" />
                )}
              </td>
              <td className={cx(FUND_TABLE_CELL, ADMIN_NUMERIC)}>
                {fund.stockCount === 0 ? (
                  <span className={FUND_TABLE_MUTED}>Not disclosed</span>
                ) : (
                  <span className={FUND_TABLE_NAME}>{String(fund.stockCount)}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
)
