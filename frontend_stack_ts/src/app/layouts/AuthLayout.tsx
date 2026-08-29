import type { ReactNode } from "react"

import { Reveal } from "~/ui/motion/Reveal"
import { AUTH_FOOTNOTE, AUTH_HEADLINE, AUTH_MARKER, AUTH_MARKERS, AUTH_MARKER_DOT, AUTH_MESH, AUTH_NARRATIVE, AUTH_PANEL_AREA, AUTH_PANEL_CORE, AUTH_PANEL_HEAD, AUTH_PANEL_SHELL, AUTH_PANEL_SLOT, AUTH_PANEL_TITLE, AUTH_SHELL, AUTH_TAGLINE, AUTH_WORDMARK } from "~/ui/recipes/auth"
import { EYEBROW } from "~/ui/recipes/surface"
import { HERO_ACCENT, RULE_GOLD } from "~/ui/recipes/text"
import { SHEET_DESCRIPTION } from "~/ui/recipes/overlay"

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
    Investing, made <span className={HERO_ACCENT}>deliberate</span>
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
  <div className={AUTH_SHELL}>
    <div className={AUTH_MESH} aria-hidden="true" />
    <div className="be-grain" aria-hidden="true" />

    <section className={AUTH_NARRATIVE}>
      <Reveal>
        <span className={EYEBROW}>{eyebrow}</span>
      </Reveal>
      <Reveal delayMs={90}>
        <h1 className={AUTH_HEADLINE}>{headline}</h1>
      </Reveal>
      <Reveal delayMs={160}>
        <span className={RULE_GOLD} />
      </Reveal>
      {tagline === undefined ? null : (
        <Reveal delayMs={210}>
          <p className={AUTH_TAGLINE}>{tagline}</p>
        </Reveal>
      )}
      <Reveal delayMs={280}>
        <ul className={AUTH_MARKERS}>
          {markers.map((marker) => (
            <li key={marker} className={AUTH_MARKER}>
              <span className={AUTH_MARKER_DOT} aria-hidden="true" />
              {marker}
            </li>
          ))}
        </ul>
      </Reveal>
    </section>

    <section className={AUTH_PANEL_AREA}>
      <Reveal delayMs={180} className={AUTH_PANEL_SLOT}>
        <div className={AUTH_PANEL_SHELL}>
          <div className={AUTH_PANEL_CORE}>
            <div className={AUTH_PANEL_HEAD}>
              <span className={AUTH_WORDMARK}>BeOnEdge</span>
              <h2 className={AUTH_PANEL_TITLE}>{panelTitle}</h2>
              {panelHint === undefined ? null : <p className={SHEET_DESCRIPTION}>{panelHint}</p>}
            </div>
            {children}
          </div>
        </div>
      </Reveal>
    </section>

    <p className={AUTH_FOOTNOTE}>
      Administrator-managed fund pools. Values are derived server-side from an append-only ledger.
    </p>
  </div>
)
