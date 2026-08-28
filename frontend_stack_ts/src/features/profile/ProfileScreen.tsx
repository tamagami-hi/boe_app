import { Link, useNavigate } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { useSession } from "~/app/providers/SessionProvider"
import { emailVerificationState, userAccountState } from "~/domain/status"
import { useAuthPort } from "~/features/auth/authPort"
import { useEligibility } from "~/features/shared/queries"
import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { StatusBadge } from "~/ui/patterns/StatusBadge"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"

import styles from "./Profile.module.css"

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
        <div className={styles.identity}>
          <span className={styles.avatar} aria-hidden="true">
            {initialsOf(principal.fullName)}
          </span>
          <span className={styles.identityText}>
            <span className={styles.name}>{principal.fullName}</span>
            <span className={styles.email}>{principal.email}</span>
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
        <div className={styles.grid}>
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
