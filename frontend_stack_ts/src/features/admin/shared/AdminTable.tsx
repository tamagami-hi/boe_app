import type { ReactNode } from "react"

import { cx } from "~/lib/cx"

import styles from "./Admin.module.css"

export type AdminColumn<TRow> = Readonly<{
  key: string
  header: string
  numeric?: boolean
  render: (row: TRow) => ReactNode
}>

export type AdminTableProps<TRow> = Readonly<{
  rows: readonly TRow[]
  columns: readonly AdminColumn<TRow>[]
  rowKey: (row: TRow) => string
  caption: string
}>

export const AdminTable = <TRow,>({
  rows,
  columns,
  rowKey,
  caption,
}: AdminTableProps<TRow>): React.ReactElement => (
  <div className={styles.tableWrap}>
    <div className={styles.tableInner}>
      <table className={styles.table}>
        <caption className="be-visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cx(styles.headCell, column.numeric === true && styles.numeric)}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className={styles.bodyRow}>
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cx(styles.cell, column.numeric === true && styles.numeric)}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
)

export const FilterRow = ({
  label,
  children,
}: Readonly<{ label: string; children: ReactNode }>): React.ReactElement => (
  <div className={styles.filters} role="group" aria-label={label}>
    {children}
  </div>
)

export type FilterChipProps = Readonly<{
  active: boolean
  label: string
  onSelect: () => void
}>

export const FilterChip = ({ active, label, onSelect }: FilterChipProps): React.ReactElement => (
  <button
    type="button"
    aria-pressed={active}
    className={active ? styles.filterActive : styles.filter}
    onClick={onSelect}
  >
    {label}
  </button>
)
