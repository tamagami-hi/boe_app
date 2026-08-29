import { Link, useNavigate } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { useSession } from "~/app/providers/SessionProvider"
import { emailVerificationState, userAccountState } from "~/domain/status"
import { useAuthPort } from "~/features/auth/authPort"
import { useEligibility } from "~/features/shared/queries"
import { cx } from "~/lib/cx"
import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { StatusBadge } from "~/ui/patterns/StatusBadge"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { ENTRY_GLYPH, ENTRY_ROW, ENTRY_TEXT, ITEM_TITLE } from "~/ui/recipes/datalist"
import { GRID_BASE, GRID_COLS_MD } from "~/ui/recipes/layout"
import { CARD_LINK } from "~/ui/recipes/surface"
import { HINT_MUTED } from "~/ui/recipes/text"

import {
  IDENTITY_AVATAR,
  IDENTITY_EMAIL,
  IDENTITY_NAME,
  IDENTITY_ROW,
  IDENTITY_TEXT,
} from "./profile.recipe"

const ENTRIES = [
  {
    to: "/statements",
    title: "Statements",
    hint: "A month-by-month derivation of your value from the ledger.",
  },
  {
    to: "/notifications",
    title: "Notifications",
    hint: "Payment confirmations, SIP reminders and account updates.",
  },
  {
    to: "/profile/email-verification",
    title: "Email verification",
    hint: "Whether investing is unlocked, and how to unlock it.",
  },
  {
    to: "/profile/security",
    title: "Device security",
    hint: "A PIN and biometric lock for this device only.",
  },
  {
    to: "/profile/support",
    title: "Support",
    hint: "Published answers and a record of everything you have raised.",
  },
  {
    to: "/profile/legal",
    title: "Legal",
    hint: "Investor charter and grievance redressal.",
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

const initialsOf = (fullName: string): string => {
  const parts = fullName.trim().split(/\s+/u).filter((part) => part !== "")
  if (parts.length === 0) return "B"
  const first = parts[0]?.[0] ?? ""
  const last = parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : ""
  return `${first}${last}`.toUpperCase()
}

const ProfileScreen = (): React.ReactElement => {
  const { principal, signedOut } = useSession()
  const auth = useAuthPort()
  const eligibility = useEligibility()
  const navigate = useNavigate()

  const signOut = (): void => {
    void auth.logout().finally(() => {
      signedOut()
      void navigate(auth.loginPath, { replace: true })
    })
  }

  if (principal === null) return <Page width="default">{null}</Page>

  const verification = eligibility.data?.emailVerificationState ?? null

  return (
    <Page width="default">
      <PageHeader title="Profile" description="Your account, and everything that governs it." />

      <Card elevated>
        <div className={IDENTITY_ROW}>
          <span className={IDENTITY_AVATAR} aria-hidden="true">
            {initialsOf(principal.fullName)}
          </span>
          <span className={IDENTITY_TEXT}>
            <span className={IDENTITY_NAME}>{principal.fullName}</span>
            <span className={IDENTITY_EMAIL}>{principal.email}</span>
          </span>
        </div>

        <DataList>
          <DetailRow label="Account">
            <StatusBadge status={userAccountState(principal.accountState)} />
          </DetailRow>
          <DetailRow label="Email verification">
            {verification === null ? (
              "—"
            ) : (
              <StatusBadge status={emailVerificationState(verification)} />
            )}
          </DetailRow>
          <DetailRow label="Investing">
            {eligibility.data?.canInvest === true ? "Unlocked" : "Locked"}
          </DetailRow>
        </DataList>
      </Card>

      <Section title="Manage">
        <div className={cx(GRID_BASE, GRID_COLS_MD[2])}>
          {ENTRIES.map((entry) => (
            <Link key={entry.to} to={entry.to} className={CARD_LINK}>
              <Card>
                <span className={ENTRY_ROW}>
                  <span className={ENTRY_TEXT}>
                    <span className={ITEM_TITLE}>{entry.title}</span>
                    <span className={cx(HINT_MUTED, "max-w-[46ch]")}>{entry.hint}</span>
                  </span>
                  <Chevron />
                </span>
              </Card>
            </Link>
          ))}
        </div>
      </Section>

      <Section
        title="Sign out"
        description="This ends the session on this device. Your account and its values are untouched."
      >
        <Button tone="secondary" onClick={signOut}>
          Sign out
        </Button>
      </Section>
    </Page>
  )
}

export default ProfileScreen
