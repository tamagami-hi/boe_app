import type { ReactNode } from "react"

import { Reveal } from "~/ui/motion/Reveal"

import styles from "./AuthLayout.module.css"

export type AuthLayoutProps = Readonly<{
  eyebrow: string
  headline?: ReactNode
  tagline?: string
  panelTitle: string
  panelHint?: string
  markers?: readonly string[]
  children: ReactNode
}>

const DEFAULT_HEADLINE = (
  <>
    Investing, made <span className={styles.headlineAccent}>deliberate</span>
  </>
)

const DEFAULT_MARKERS = [
  "Server-derived valuations",
  "Append-only ledger",
  "Idempotent money movement",
] as const

export const AuthLayout = ({
  eyebrow,
  headline = DEFAULT_HEADLINE,
  tagline,
  panelTitle,
  panelHint,
  markers = DEFAULT_MARKERS,
  children,
}: AuthLayoutProps): React.ReactElement => (
  <div className={styles.shell}>
    <div className="be-grain" />

    <section className={styles.narrative}>
      <Reveal>
        <span className={styles.eyebrow}>{eyebrow}</span>
      </Reveal>
      <Reveal delayMs={90}>
        <h1 className={styles.headline}>{headline}</h1>
      </Reveal>
      <Reveal delayMs={160}>
        <span className={styles.rule} />
      </Reveal>
      {tagline === undefined ? null : (
        <Reveal delayMs={210}>
          <p className={styles.tagline}>{tagline}</p>
        </Reveal>
      )}
      <Reveal delayMs={280}>
        <ul className={styles.markers}>
          {markers.map((marker) => (
            <li key={marker} className={styles.marker}>
              <span className={styles.markerDot} aria-hidden="true" />
              {marker}
            </li>
          ))}
        </ul>
      </Reveal>
    </section>

    <section className={styles.panelArea}>
      <Reveal delayMs={180}>
        <div className={styles.panelShell}>
          <div className={styles.panelCore}>
            <div className={styles.panelHead}>
              <span className={styles.wordmark}>BeOnEdge</span>
              <h2 className={styles.panelTitle}>{panelTitle}</h2>
              {panelHint === undefined ? null : (
                <p className={styles.panelHint}>{panelHint}</p>
              )}
            </div>
            {children}
          </div>
        </div>
      </Reveal>
    </section>

    <p className={styles.footnote}>
      Administrator-managed fund pools. Values are derived server-side from an append-only ledger.
    </p>
  </div>
)
