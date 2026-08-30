import { useNavigate } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { CLIENT_ROUTES } from "~/app/routing/clientRoutes"
import { resolveDestination } from "~/app/routing/resolveDestination"
import { formatDateTime } from "~/domain/dates"
import { useMarkNotificationRead, useNotifications } from "~/features/shared/queries"
import { cx } from "~/lib/cx"
import { openDestination } from "~/platform/openExternal"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { LoadMore } from "~/ui/patterns/LoadMore"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"
import { ITEM_TITLE, PROSE_SM } from "~/ui/recipes/datalist"
import { ACTION_ROW, CARD_COLUMNS, ROW_BETWEEN, STACK_SM } from "~/ui/recipes/layout"
import { CARD_STACK } from "~/ui/recipes/surface"
import { COUNT_TEXT, META_ROW } from "~/ui/recipes/text"

import { NOTIFICATION_UNREAD } from "./notifications.recipe"

const deepLinkOf = (payload: Record<string, unknown>): string | null => {
  const candidate = payload.deepLink ?? payload.link ?? payload.path
  return typeof candidate === "string" && candidate.trim() !== "" ? candidate : null
}

const NotificationsScreen = (): React.ReactElement => {
  const query = useNotifications()
  const markRead = useMarkNotificationRead()
  const navigate = useNavigate()

  const follow = (candidate: string): void => {
    const destination = resolveDestination(candidate, CLIENT_ROUTES)
    if (destination.kind === "internal") {
      void navigate(destination.path)
      return
    }
    void openDestination(destination)
  }

  return (
    <Page width="default">
      <PageHeader
        title="Notifications"
        description="Everything the backend has told your account about, newest first."
      />

      <AsyncBoundary
        query={query}
        skeleton={
          <div className={cx(CARD_STACK, CARD_COLUMNS[3])}>
            {[0, 1, 2].map((index) => (
              <Card key={index}>
                <Skeleton height="1rem" width="55%" />
                <Skeleton height="0.85rem" width="80%" />
              </Card>
            ))}
          </div>
        }
        isEmpty={(data) => data.items.length === 0}
        empty={
          <EmptyState
            title="Nothing to read"
            description="Payment confirmations, SIP reminders and account updates arrive here."
          />
        }
      >
        {(data) => (
          <>
            <span className={COUNT_TEXT}>
              {data.unreadCount === 0
                ? `${String(data.items.length)} loaded`
                : `${String(data.unreadCount)} unread on this account`}
            </span>
            <div className={cx(CARD_STACK, CARD_COLUMNS[3])}>
              {data.items.map((item) => {
                const link = deepLinkOf(item.payload)
                return (
                  <Card key={item.id} tone={item.read ? "default" : "elevated"}>
                    <div className={STACK_SM}>
                      <div className={ROW_BETWEEN}>
                        <span
                          className={cx(ITEM_TITLE, item.read ? undefined : NOTIFICATION_UNREAD)}
                        >
                          {item.title}
                        </span>
                      </div>
                      <p className={PROSE_SM}>{item.body}</p>
                      <div className={META_ROW}>
                        <span>{formatDateTime(item.createdAt)}</span>
                        <span>{item.kind}</span>
                      </div>
                      <div className={cx(ACTION_ROW, "pt-1")}>
                        {link === null ? null : (
                          <Button
                            tone="secondary"
                            size="sm"
                            onClick={() => {
                              follow(link)
                            }}
                          >
                            Open
                          </Button>
                        )}
                        {item.read ? null : (
                          <Button
                            tone="ghost"
                            size="sm"
                            loading={markRead.isPending && markRead.variables === item.id}
                            onClick={() => {
                              markRead.mutate(item.id)
                            }}
                          >
                            Mark read
                          </Button>
                        )}
                      </div>
                    </div>
                  </Card>
                )
              })}
            </div>
          </>
        )}
      </AsyncBoundary>
      <LoadMore list={query} noun="notifications" />
    </Page>
  )
}

export default NotificationsScreen
