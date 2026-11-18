import { isApiError, isSessionEnded } from "~/api/errors"
import type { PagedQuery } from "~/api/paged"
import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { useSession } from "~/app/providers/SessionProvider"
import { ADMIN_ROUTES } from "~/app/routing/adminRoutes"
import { roleLabel, type PermissionCode } from "~/domain/permissions"
import {
  useAdminApplications,
  useAdminMandates,
  useAdminReceipts,
  useAdminRefunds,
} from "~/features/admin/shared/adminQueries"
import { ContentGrid } from "~/app/layouts/ContentGrid"
import { Stat } from "~/ui/patterns/DataList"

import { Button } from "~/ui/primitives/Button"
import { ButtonLink } from "~/ui/primitives/ButtonLink"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"

import { ADMIN_META, ADMIN_QUEUE_COUNT } from "~/ui/recipes/admin"
import { PROSE_SM } from "~/ui/recipes/datalist"
import { ACTION_ROW } from "~/ui/recipes/layout"
import { META_MUTED } from "~/ui/recipes/text"

import { DailyTiles } from "./DailyTiles"

const QUEUE_ENTRIES = [
  {
    id: "applications",
    to: "/applications",
    label: "Applications waiting",
    hint: "Each one is a person who cannot sign in until it is decided.",
    readPermissions: ["applications.read"],
  },
  {
    id: "receipts",
    to: "/receipts",
    label: "Receipts to acknowledge",
    hint: "A settled payment is not investable until you acknowledge the funds.",
    readPermissions: ["funds.receipts.read", "funds.receipts.write"],
  },
  {
    id: "refunds",
    to: "/refunds",
    label: "Refunds needing attention",
    hint: "A failed refund does not retry itself.",
    readPermissions: ["funds.receipts.read", "refunds.write"],
  },
  {
    id: "mandates",
    to: "/mandates",
    label: "Mandates needing attention",
    hint: "Setup or cancellation stuck mid-flight with the provider.",
    readPermissions: ["payments.read"],
  },
] as const satisfies readonly Readonly<{
  id: string
  to: string
  label: string
  hint: string
  readPermissions: readonly PermissionCode[]
}>[]

type QueueEntry = (typeof QUEUE_ENTRIES)[number]
type QueueList = PagedQuery<{ items: readonly unknown[] }>
type QueueProps = Readonly<{ entry: QueueEntry; canOpen: boolean }>

const depth = (list: QueueList, data: Readonly<{ items: readonly unknown[] }>): string =>
  `${String(data.items.length)}${list.hasMore ? "+" : ""}`

const QueueReading = ({ list }: Readonly<{ list: QueueList }>): React.ReactElement => {
  const { data, error } = list
  if (data !== undefined) {
    return (
      <>
        <span className={ADMIN_QUEUE_COUNT}>{depth(list, data)}</span>
        {error === null || error === undefined ? null : (
          <span className={META_MUTED}>The last refresh failed, so this count may be out of date.</span>
        )}
      </>
    )
  }
  if (error === null || error === undefined || isSessionEnded(error)) {
    return <Skeleton height="2rem" width="3rem" />
  }
  if (isApiError(error) && error.code === "RESOURCE_NOT_FOUND") {
    return <span className={META_MUTED}>This queue is not set up on this server, so there is nothing to count.</span>
  }
  if (isApiError(error) && error.code === "AUTHORIZATION_DENIED") {
    return <span className={META_MUTED}>Your account cannot read this queue.</span>
  }
  return (
    <>
      <span className={META_MUTED}>This queue could not be loaded.</span>
      <Button tone="secondary" size="sm" onClick={list.refetch}>
        Try again
      </Button>
    </>
  )
}

const QueueCard = ({ entry, canOpen, list }: QueueProps & Readonly<{ list: QueueList | null }>): React.ReactElement => (
  <Card elevated>
    <Stat label={entry.label} hint={entry.hint}>
      {list === null ? <span className={META_MUTED}>Not available with your permissions.</span> : <QueueReading list={list} />}
    </Stat>
    {canOpen ? (
      <ButtonLink to={entry.to} tone="ghost" size="sm" trailing>
        Open
      </ButtonLink>
    ) : null}
  </Card>
)

const ApplicationsQueue = (props: QueueProps): React.ReactElement => {
  const list = useAdminApplications({ status: "submitted" })
  return <QueueCard {...props} list={list} />
}

const ReceiptsQueue = (props: QueueProps): React.ReactElement => {
  const list = useAdminReceipts("pending")
  return <QueueCard {...props} list={list} />
}

const RefundsQueue = (props: QueueProps): React.ReactElement => {
  const list = useAdminRefunds("failed")
  return <QueueCard {...props} list={list} />
}

const MandatesQueue = (props: QueueProps): React.ReactElement => {
  const list = useAdminMandates({ attention: true })
  return <QueueCard {...props} list={list} />
}

const QUEUE_TILES: Readonly<Record<QueueEntry["id"], (props: QueueProps) => React.ReactElement>> = {
  applications: ApplicationsQueue,
  receipts: ReceiptsQueue,
  refunds: RefundsQueue,
  mandates: MandatesQueue,
}

const OverviewScreen = (): React.ReactElement => {
  const { principal, hasAnyPermission, hasAllPermissions } = useSession()

  const reachable = ADMIN_ROUTES.filter(
    (route) =>
      route.nav !== undefined &&
      hasAnyPermission(route.permissions ?? []) &&
      hasAllPermissions(route.requiresAll ?? []),
  )
  const reachablePaths = new Set(reachable.map((route) => route.path))

  return (
    <Page width="wide">
      <PageHeader
        title="Overview"
        description="What is waiting for a decision, and where to make it. Every number is up to date when you open this page."
      />

      <DailyTiles reachablePaths={reachablePaths} />

      <Section title="Queues">
        <ContentGrid columns={4}>
          {QUEUE_ENTRIES.map((entry) => {
            const canOpen = reachablePaths.has(entry.to)
            if (!hasAnyPermission(entry.readPermissions)) {
              return <QueueCard key={entry.id} entry={entry} canOpen={canOpen} list={null} />
            }
            const Tile = QUEUE_TILES[entry.id]
            return <Tile key={entry.id} entry={entry} canOpen={canOpen} />
          })}
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
              : principal.roles.map((role) => <span key={role}>{roleLabel(role)}</span>)}
          </div>
          <div className={ACTION_ROW}>
            {reachable.map((route) => (
              <ButtonLink key={route.id} to={route.path} tone="secondary" size="sm">
                {route.nav?.label ?? route.title}
              </ButtonLink>
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
