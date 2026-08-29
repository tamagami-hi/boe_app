import type { ReactNode } from "react"

import { cx } from "~/lib/cx"
import {
  ADMIN_BODY_ROW,
  ADMIN_CELL,
  ADMIN_FILTER,
  ADMIN_FILTER_ROW,
  ADMIN_HEAD_CELL,
  ADMIN_NUMERIC,
  ADMIN_TABLE,
  ADMIN_TABLE_INNER,
  ADMIN_TABLE_WRAP,
} from "~/ui/recipes/admin"

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
  <div className={ADMIN_TABLE_WRAP}>
    <div className={ADMIN_TABLE_INNER}>
      <table className={ADMIN_TABLE}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cx(ADMIN_HEAD_CELL, column.numeric === true && ADMIN_NUMERIC)}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} className={ADMIN_BODY_ROW}>
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cx(ADMIN_CELL, column.numeric === true && ADMIN_NUMERIC)}
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
  <div className={ADMIN_FILTER_ROW} role="group" aria-label={label}>
    {children}
  </div>
)

export type FilterChipProps = Readonly<{
  active: boolean
  label: string
  onSelect: () => void
}>

export const FilterChip = ({ active, label, onSelect }: FilterChipProps): React.ReactElement => (
  <button type="button" aria-pressed={active} className={ADMIN_FILTER} onClick={onSelect}>
    {label}
  </button>
)
