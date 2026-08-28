import { Link } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Card } from "~/ui/primitives/Card"

import styles from "./Legal.module.css"

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
    className={styles.entryGlyph}
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

    <div className={styles.hub}>
      {ENTRIES.map((entry) => (
        <Link key={entry.to} to={entry.to} className={styles.entryLink}>
          <Card>
            <span className={styles.entry}>
              <span className={styles.entryText}>
                <span className={styles.entryTitle}>{entry.title}</span>
                <span className={styles.entryHint}>{entry.hint}</span>
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
