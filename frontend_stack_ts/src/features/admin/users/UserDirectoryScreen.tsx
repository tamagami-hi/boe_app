import { useMemo, useState } from "react"
import { useSearchParams } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { useSession } from "~/app/providers/SessionProvider"
import { ButtonLink } from "~/ui/primitives/ButtonLink"
import { formatDate } from "~/domain/dates"
import { emailVerificationState, userAccountState } from "~/domain/status"
import { useDirectoryReturns } from "~/features/admin/client-returns/directoryReturns"
import { AdminTable, FilterChip, FilterRow } from "~/features/admin/shared/AdminTable"
import { ClientPageLink } from "~/features/admin/shared/clientPageLink"
import { useUrlFilter } from "~/features/admin/shared/urlFilter"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { LoadMore } from "~/ui/patterns/LoadMore"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { StatusBadge } from "~/ui/patterns/StatusBadge"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"
import { Input } from "~/ui/primitives/FormField"

import { ENTRY_TEXT } from "~/ui/recipes/datalist"
import { META_TEXT } from "~/ui/recipes/text"

import { useAdminUsers } from "./userDirectoryQueries"

const FILTERS = [
  { value: "any", label: "All" },
  { value: "active", label: "Active" },
  { value: "suspended", label: "Suspended" },
  { value: "closed", label: "Closed" },
] as const

const SEGMENTS = [
  { value: "everyone", label: "Everyone" },
  { value: "clients", label: "Clients" },
  { value: "pending_invites", label: "Invite not accepted" },
] as const

const MAX_SEARCH_LENGTH = 120

const searchOf = (text: string | null): string => (text ?? "").trim().slice(0, MAX_SEARCH_LENGTH)

const UserDirectoryScreen = (): React.ReactElement => {
  const { hasAnyPermission } = useSession()
  const canCreateClient = hasAnyPermission(["clients.create"])
  const [searchParams, setSearchParams] = useSearchParams()
  const applied = searchOf(searchParams.get("q"))
  const [filter, setFilter] = useUrlFilter("status", FILTERS, "any")
  const [segment, setSegment] = useUrlFilter("segment", SEGMENTS, "everyone")
  const [typed, setTyped] = useState({ text: applied, appliedTo: applied })
  const search = typed.appliedTo === applied ? typed.text : applied
  const applySearch = (): void => {
    const next = searchOf(search)
    if (next === applied) return
    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current)
        if (next === "") params.delete("q")
        else params.set("q", next)
        return params
      },
      { replace: true },
    )
  }
  const query = useAdminUsers({
    ...(filter === "any" ? {} : { status: filter }),
    ...(applied === "" ? {} : { q: applied }),
    ...(segment === "everyone" ? {} : { segment }),
  })
  const visibleIds = useMemo(() => (query.data?.items ?? []).map((row) => row.id), [query.data])
  const returns = useDirectoryReturns(visibleIds)

  return (
    <Page width="wide">
      <PageHeader
        title="Users"
        description="Every account on the platform. Search covers every user, not just the page in front of you."
        actions={
          canCreateClient ? (
            <ButtonLink to="/users/create" tone="secondary" size="sm" trailing>
              Create a client
            </ButtonLink>
          ) : null
        }
      />

      <Input
        type="search"
        placeholder="Search by email, phone or name"
        aria-label="Search users"
        value={search}
        onChange={(event) => {
          setTyped({ text: event.target.value, appliedTo: applied })
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") applySearch()
        }}
        onBlur={applySearch}
      />

      <FilterRow label="Accounts">
        {SEGMENTS.map((option) => (
          <FilterChip
            key={option.value}
            active={option.value === segment}
            label={option.label}
            onSelect={() => {
              setSegment(option.value)
            }}
          />
        ))}
      </FilterRow>

      <FilterRow label="Account state">
        {FILTERS.map((option) => (
          <FilterChip
            key={option.value}
            active={option.value === filter}
            label={option.label}
            onSelect={() => {
              setFilter(option.value)
            }}
          />
        ))}
      </FilterRow>

      {returns.notice}

      <AsyncBoundary
        query={query}
        skeleton={
          <Card>
            <Skeleton height="1rem" width="45%" />
            <Skeleton height="1rem" width="70%" />
          </Card>
        }
        isEmpty={(data) => data.items.length === 0}
        empty={
          <EmptyState
            title="No user matches"
            description="Clear the search or choose other filters."
          />
        }
      >
        {(data) => (
          <AdminTable
            caption="Users"
            rows={data.items}
            rowKey={(row) => row.id}
            columns={[
              {
                key: "user",
                header: "User",
                render: (row) => (
                  <span className={ENTRY_TEXT}>
                    <ClientPageLink userId={row.id}>{row.fullName}</ClientPageLink>
                    <span className={META_TEXT}>{row.email}</span>
                  </span>
                ),
              },
              { key: "phone", header: "Phone", render: (row) => row.phone },
              {
                key: "state",
                header: "Account",
                render: (row) => (
                  <StatusBadge
                    status={userAccountState(row.accountState)}
                  />
                ),
              },
              {
                key: "verification",
                header: "Email",
                render: (row) =>
                  row.emailVerificationStatus === null ? (
                    "—"
                  ) : (
                    <StatusBadge
                      status={emailVerificationState(
                        row.emailVerificationStatus,
                      )}
                    />
                  ),
              },
              {
                key: "orders",
                header: "Orders",
                numeric: true,
                render: (row) => String(row.ordersCount),
              },
              ...returns.columns,
              {
                key: "created",
                header: "Joined",
                render: (row) => formatDate(row.createdAt),
              },
            ]}
          />
        )}
      </AsyncBoundary>
      <LoadMore list={query} noun="accounts" />
    </Page>
  )
}

export default UserDirectoryScreen
