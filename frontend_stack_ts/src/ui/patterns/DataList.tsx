import { useState } from "react"
import type { ReactNode } from "react"

import styles from "./DataList.module.css"

export type DetailRowProps = Readonly<{
  label: string
  children: ReactNode
}>

export const DetailRow = ({ label, children }: DetailRowProps): React.ReactElement => (
  <li className={styles.row}>
    <span className={styles.label}>{label}</span>
    <span className={styles.value}>{children}</span>
  </li>
)

export type DataListProps = Readonly<{ children: ReactNode }>

export const DataList = ({ children }: DataListProps): React.ReactElement => (
  <ul className={styles.list}>{children}</ul>
)

export type StatProps = Readonly<{
  label: string
  hint?: string
  children: ReactNode
}>

export const Stat = ({ label, hint, children }: StatProps): React.ReactElement => (
  <div className={styles.stat}>
    <span className={styles.statLabel}>{label}</span>
    {children}
    {hint === undefined ? null : <span className={styles.statHint}>{hint}</span>}
  </div>
)

export type ProseProps = Readonly<{ children: ReactNode }>

export const Prose = ({ children }: ProseProps): React.ReactElement => (
  <p className={styles.body}>{children}</p>
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
    <div className={styles.disclosure}>
      <button
        type="button"
        className={styles.disclosureButton}
        aria-expanded={open}
        onClick={() => {
          setOpen(!open)
        }}
      >
        {title}
        <svg
          className={open ? styles.disclosureGlyphOpen : styles.disclosureGlyph}
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
      {open ? <div className={styles.disclosurePanel}>{children}</div> : null}
    </div>
  )
}
