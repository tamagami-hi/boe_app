import { useState } from "react"
import { Link } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { formatDate } from "~/domain/dates"
import { emailVerificationState, userAccountState } from "~/domain/status"
import { useAdminUsers } from "~/features/admin/shared/adminQueries"
import { AdminTable, FilterChip, FilterRow } from "~/features/admin/shared/AdminTable"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { StatusBadge } from "~/ui/patterns/StatusBadge"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"
import { Input } from "~/ui/primitives/FormField"

import styles from "~/features/admin/shared/Admin.module.css"

const FILTERS = [
  { value: "any", label: "All" },
  { value: "active", label: "Active" },
  { value: "invited", label: "Invited" },
  { value: "suspended", label: "Suspended" },
  { value: "closed", label: "Closed" },
] as const

type Filter = (typeof FILTERS)[number]["value"]

const UserDirectoryScreen = (): React.ReactElement => {
  const [filter, setFilter] = useState<Filter>("any")
  const [search, setSearch] = useState("")
  const [applied, setApplied] = useState("")
  const query = useAdminUsers({
    ...(filter === "any" ? {} : { status: filter }),
    ...(applied === "" ? {} : { q: applied }),
  })

  return (
    <Page width="wide">
      <PageHeader
        title="Users"
        description="Every account on the platform. Search runs on the server, so it covers every user, not just the page in front of you."
      />

      <Input
        type="search"
        placeholder="Search by email, phone or name"
        aria-label="Search users"
        value={search}
        onChange={(event) => {
          setSearch(event.target.value)
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") setApplied(search.trim())
        }}
        onBlur={() => {
          setApplied(search.trim())
        }}
      />

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
            description="Clear the search or choose another account state."
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
                  <span className={styles.cellStack}>
                    <Link to={`/users/${row.id}`} className={styles.cellLink}>
                      {row.fullName}
                    </Link>
                    <span className={styles.faint}>{row.email}</span>
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
              {
                key: "created",
                header: "Joined",
                render: (row) => formatDate(row.createdAt),
              },
            ]}
          />
        )}
      </AsyncBoundary>
    </Page>
  )
}

export default UserDirectoryScreen
