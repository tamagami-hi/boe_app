import { useId, useState } from "react"

import { cx } from "~/lib/cx"
import {
  DISCLOSURE_BUTTON,
  DISCLOSURE_GLYPH,
  DISCLOSURE_GLYPH_OPEN,
  DISCLOSURE_PANEL,
  DISCLOSURE_ROOT,
} from "~/ui/recipes/datalist"

import { RELEASE_HEADING, RELEASE_MONTH, RELEASE_TITLE, RELEASE_VERSION, RELEASES } from "./whatsNew.recipe"
import { versionTitle, type WhatsNewEntry, type WhatsNewNotes as Notes } from "./whatsNewEntry"
import { WhatsNewNotes } from "./WhatsNewNotes"

export type ReleaseHeadingLevel = "h2" | "h3"

const SECTION_LEVEL: Readonly<Record<ReleaseHeadingLevel, "h3" | "h4">> = { h2: "h3", h3: "h4" }

type ReleaseProps = Readonly<{ entry: WhatsNewEntry; headingLevel: ReleaseHeadingLevel; defaultOpen: boolean }>

const Release = ({ entry, headingLevel: Heading, defaultOpen }: ReleaseProps): React.ReactElement => {
  const [open, setOpen] = useState(defaultOpen)
  const panelId = useId()
  return (
    <div className={DISCLOSURE_ROOT}>
      <Heading className={RELEASE_HEADING}>
        <button
          type="button"
          className={DISCLOSURE_BUTTON}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => {
            setOpen((wasOpen) => !wasOpen)
          }}
        >
          <span className={RELEASE_TITLE}>
            <span className={RELEASE_VERSION}>{versionTitle(entry)}</span>
            {entry.month === undefined ? null : (
              <>
                {" "}
                <span className={RELEASE_MONTH}>{entry.month}</span>
              </>
            )}
          </span>
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
      </Heading>
      <div id={panelId} className={DISCLOSURE_PANEL} hidden={!open}>
        <WhatsNewNotes entry={entry} headingLevel={SECTION_LEVEL[Heading]} />
      </div>
    </div>
  )
}

export type WhatsNewReleasesProps = Readonly<{ entries: Notes; headingLevel: ReleaseHeadingLevel }>

export const WhatsNewReleases = ({ entries, headingLevel }: WhatsNewReleasesProps): React.ReactElement => (
  <div className={RELEASES}>
    {entries.map((entry, index) => (
      <Release key={entry.id} entry={entry} headingLevel={headingLevel} defaultOpen={index === 0} />
    ))}
  </div>
)
