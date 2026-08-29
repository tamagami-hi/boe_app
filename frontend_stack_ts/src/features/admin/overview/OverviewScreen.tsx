import { Link } from "react-router-dom"

import { isApiError } from "~/api/errors"
import type { PagedQuery } from "~/api/paged"
import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { useSession } from "~/app/providers/SessionProvider"
import { ADMIN_ROUTES } from "~/app/routing/adminRoutes"
import {
  useAdminApplications,
  useAdminMandates,
  useAdminReceipts,
  useAdminRefunds,
} from "~/features/admin/shared/adminQueries"
import { ContentGrid } from "~/app/layouts/ContentGrid"
import { Stat } from "~/ui/patterns/DataList"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"

import { ADMIN_META, ADMIN_QUEUE_COUNT } from "~/ui/recipes/admin"
import { PROSE_SM } from "~/ui/recipes/datalist"
import { ACTION_ROW } from "~/ui/recipes/layout"
import { CARD_LINK } from "~/ui/recipes/surface"

const QUEUE_ENTRIES = [
  {
    id: "applications",
    to: "/applications",
    label: "Applications waiting",
    hint: "Each one is a person who cannot sign in until it is decided.",
  },
  {
    id: "receipts",
    to: "/receipts",
    label: "Receipts to acknowledge",
    hint: "A settled payment is not investable until you acknowledge the funds.",
  },
  {
    id: "refunds",
    to: "/refunds",
    label: "Refunds needing attention",
    hint: "A failed refund does not retry itself.",
  },
  {
    id: "mandates",
    to: "/mandates",
    label: "Mandates needing attention",
    hint: "Setup or cancellation stuck mid-flight with the provider. Shows n/a when PhonePe is not configured here.",
  },
] as const

const OverviewScreen = (): React.ReactElement => {
  const { principal, hasAnyPermission } = useSession()
  const applications = useAdminApplications({ status: "submitted" })
  const receipts = useAdminReceipts("pending")
  const refunds = useAdminRefunds("failed")
  const mandates = useAdminMandates({ attention: true })

  const notConfigured = (error: unknown): boolean =>
    isApiError(error) && error.code === "RESOURCE_NOT_FOUND"

  /**
   * There is no count endpoint, so a tile can only report what it has read. A
   * queue with another page behind it is shown as "25+" rather than as a total
   * that happens to equal the page size.
   */
  const depth = (list: PagedQuery<{ items: readonly unknown[] }>): string =>
    list.data === undefined
      ? "—"
      : `${String(list.data.items.length)}${list.hasMore ? "+" : ""}`

  const counts: Readonly<Record<string, string>> = {
    applications: depth(applications),
    receipts: depth(receipts),
    refunds: depth(refunds),
    mandates: notConfigured(mandates.error) ? "n/a" : depth(mandates),
  }

  const reachable = ADMIN_ROUTES.filter(
    (route) =>
      route.nav !== undefined &&
      (route.permissions === undefined || hasAnyPermission(route.permissions)),
  )

  return (
    <Page width="wide">
      <PageHeader
        title="Overview"
        description="What is waiting for a decision, and where to make it. Every number is read live from the backend."
      />

      <Section title="Queues">
        <ContentGrid columns={4}>
          {QUEUE_ENTRIES.map((entry) => (
            <Card key={entry.id} elevated>
              <Stat label={entry.label} hint={entry.hint}>
                <span className={ADMIN_QUEUE_COUNT}>{counts[entry.id] ?? "—"}</span>
              </Stat>
              <Link to={entry.to} className={CARD_LINK}>
                <Button tone="ghost" size="sm" trailing>
                  Open
                </Button>
              </Link>
            </Card>
          ))}
        </ContentGrid>
      </Section>

      <Section
        title="Your access"
        description="These sections are open to you because of the permissions on your account."
      >
        <Card>
          <div className={ADMIN_META}>
            {principal === null
              ? null
              : principal.roles.map((role) => <span key={role}>{role}</span>)}
          </div>
          <div className={ACTION_ROW}>
            {reachable.map((route) => (
              <Link key={route.id} to={route.path} className={CARD_LINK}>
                <Button tone="secondary" size="sm">
                  {route.nav?.label ?? route.title}
                </Button>
              </Link>
            ))}
          </div>
          <p className={PROSE_SM}>
            {principal === null
              ? ""
              : `${String(principal.permissions.length)} permission(s) are active on this session. A section you cannot see is a permission you do not hold, not a missing feature.`}
          </p>
        </Card>
      </Section>
    </Page>
  )
}

export default OverviewScreen
