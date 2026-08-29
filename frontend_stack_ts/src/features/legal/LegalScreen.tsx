import { Link } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { cx } from "~/lib/cx"
import { Card } from "~/ui/primitives/Card"
import { ENTRY_GLYPH, ENTRY_ROW, ENTRY_TEXT, ITEM_TITLE } from "~/ui/recipes/datalist"
import { GRID_BASE, GRID_COLS_MD } from "~/ui/recipes/layout"
import { CARD_LINK } from "~/ui/recipes/surface"
import { HINT_MUTED } from "~/ui/recipes/text"

const ENTRIES = [
  {
    to: "/profile/legal/investor-charter",
    title: "Investor charter",
    hint: "Your rights and responsibilities as an investor, and who to contact.",
  },
  {
    to: "/profile/legal/grievance",
    title: "Grievance redressal",
    hint: "How to raise a complaint, the timelines we hold ourselves to, and how to escalate.",
  },
] as const

const Chevron = (): React.ReactElement => (
  <svg
    className={ENTRY_GLYPH}
    viewBox="0 0 18 18"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.15"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M6.75 3.75 12 9l-5.25 5.25" />
  </svg>
)

const LegalScreen = (): React.ReactElement => (
  <Page width="default">
    <PageHeader
      title="Legal"
      description="The regulatory documents that govern your account. Each one is published by BeOnEdge and served from the backend."
    />

    <div className={cx(GRID_BASE, GRID_COLS_MD[2])}>
      {ENTRIES.map((entry) => (
        <Link key={entry.to} to={entry.to} className={CARD_LINK}>
          <Card>
            <span className={ENTRY_ROW}>
              <span className={ENTRY_TEXT}>
                <span className={ITEM_TITLE}>{entry.title}</span>
                <span className={cx(HINT_MUTED, "max-w-[52ch]")}>{entry.hint}</span>
              </span>
              <Chevron />
            </span>
          </Card>
        </Link>
      ))}
    </div>
  </Page>
)

export default LegalScreen
