import { Link } from "react-router-dom"

import { toPaise } from "~/domain/money"
import { cx } from "~/lib/cx"
import { fundRiskLevel } from "~/domain/status"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { StatusBadge } from "~/ui/patterns/StatusBadge"

import styles from "./FundTable.module.css"

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
    className={styles.sortGlyph}
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
  <div className={styles.wrap}>
    <div className={styles.inner}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col" className={styles.headCell}>
              <button
                type="button"
                className={sort === "name" ? styles.headButtonActive : styles.headButton}
                aria-pressed={sort === "name"}
                onClick={() => {
                  onSort("name")
                }}
              >
                Fund
                {sort === "name" ? <SortGlyph /> : null}
              </button>
            </th>
            <th scope="col" className={styles.headCell}>
              <button
                type="button"
                className={sort === "risk" ? styles.headButtonActive : styles.headButton}
                aria-pressed={sort === "risk"}
                onClick={() => {
                  onSort("risk")
                }}
              >
                Risk
                {sort === "risk" ? <SortGlyph /> : null}
              </button>
            </th>
            <th scope="col" className={cx(styles.headCell, styles.numeric)}>
              <button
                type="button"
                className={sort === "size" ? styles.headButtonActive : styles.headButton}
                aria-pressed={sort === "size"}
                onClick={() => {
                  onSort("size")
                }}
              >
                Fund size
                {sort === "size" ? <SortGlyph /> : null}
              </button>
            </th>
            <th scope="col" className={cx(styles.headCell, styles.numeric)}>
              <span className={styles.headStatic}>Holdings</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((fund) => (
            <tr key={fund.id} className={styles.row}>
              <td className={styles.cell}>
                <Link to={`/funds/${fund.id}`} className={styles.nameLink}>
                  <span className={styles.name}>{fund.name}</span>
                  <span className={styles.category}>{fund.category}</span>
                </Link>
              </td>
              <td className={styles.cell}>
                <StatusBadge status={fundRiskLevel(fund.riskLevel)} />
              </td>
              <td className={cx(styles.cell, styles.numeric)}>
                {fund.fundSize === null ? (
                  <span className={styles.muted}>Not published</span>
                ) : (
                  <MoneyValue amount={toPaise(fund.fundSize.aumPaise)} size="md" />
                )}
              </td>
              <td className={cx(styles.cell, styles.numeric)}>
                {fund.stockCount === 0 ? (
                  <span className={styles.muted}>Not disclosed</span>
                ) : (
                  <span className={styles.name}>{String(fund.stockCount)}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
)
