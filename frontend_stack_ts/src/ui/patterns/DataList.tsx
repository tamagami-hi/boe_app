import { useState } from "react"
import type { ReactNode } from "react"

import { cx } from "~/lib/cx"
import { DISCLOSURE_BUTTON, DISCLOSURE_GLYPH, DISCLOSURE_GLYPH_OPEN, DISCLOSURE_PANEL, DISCLOSURE_ROOT, LIST_LABEL, LIST_ROOT, LIST_ROW, LIST_SPLIT, LIST_VALUE, PROSE_BODY, STAT_LABEL, STAT_ROOT } from "~/ui/recipes/datalist"
import { META_MUTED } from "~/ui/recipes/text"

export type DetailRowProps = Readonly<{
  label: string
  children: ReactNode
}>

export const DetailRow = ({ label, children }: DetailRowProps): React.ReactElement => (
  <li className={LIST_ROW}>
    <span className={LIST_LABEL}>{label}</span>
    <span className={LIST_VALUE}>{children}</span>
  </li>
)

export type DataListProps = Readonly<{
  split?: boolean
  children: ReactNode
}>

export const DataList = ({ split = false, children }: DataListProps): React.ReactElement => (
  <ul className={cx(LIST_ROOT, split ? LIST_SPLIT : undefined)}>{children}</ul>
)

export type StatProps = Readonly<{
  label: string
  hint?: string
  children: ReactNode
}>

export const Stat = ({ label, hint, children }: StatProps): React.ReactElement => (
  <div className={STAT_ROOT}>
    <span className={STAT_LABEL}>{label}</span>
    {children}
    {hint === undefined ? null : <span className={META_MUTED}>{hint}</span>}
  </div>
)

export type ProseProps = Readonly<{ children: ReactNode }>

export const Prose = ({ children }: ProseProps): React.ReactElement => (
  <p className={PROSE_BODY}>{children}</p>
)

export type DisclosureProps = Readonly<{
  title: string
  defaultOpen?: boolean
  children: ReactNode
}>

export const Disclosure = ({
  title,
  defaultOpen = false,
  children,
}: DisclosureProps): React.ReactElement => {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={DISCLOSURE_ROOT}>
      <button
        type="button"
        className={DISCLOSURE_BUTTON}
        aria-expanded={open}
        onClick={() => {
          setOpen(!open)
        }}
      >
        {title}
        <svg
          className={cx(DISCLOSURE_GLYPH, open ? DISCLOSURE_GLYPH_OPEN : undefined)}
          viewBox="0 0 18 18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.15"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M9 4v10" />
          <path d="M4 9h10" />
        </svg>
      </button>
      {open ? <div className={DISCLOSURE_PANEL}>{children}</div> : null}
    </div>
  )
}
