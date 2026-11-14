import { useRef } from "react"
import { useNavigate } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { useToast } from "~/app/providers/ToastProvider"
import { CLIENT_ROUTES } from "~/app/routing/clientRoutes"
import { notificationLink, resolveDestination, type Destination } from "~/app/routing/resolveDestination"
import { formatDateTime } from "~/domain/dates"
import { describeClientFailure } from "~/domain/failure"
import { useUpdatePrompt } from "~/features/app-update/updatePrompt"
import { notificationCategory } from "~/domain/notifications"
import { useMarkNotificationRead, useNotifications } from "~/features/shared/queries"
import { cx } from "~/lib/cx"
import { openDestination } from "~/platform/openExternal"
import { AsyncBoundary } from "~/ui/patterns/AsyncBoundary"
import { LoadMore } from "~/ui/patterns/LoadMore"
import { EmptyState } from "~/ui/patterns/EmptyState"
import { Badge } from "~/ui/primitives/Badge"
import { Button } from "~/ui/primitives/Button"
import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"
import { ITEM_TITLE, PROSE_SM } from "~/ui/recipes/datalist"
import { ACTION_ROW, FEED_MEASURE, ROW_BETWEEN, STACK_SM } from "~/ui/recipes/layout"
import { CARD_STACK } from "~/ui/recipes/surface"
import { COUNT_TEXT, META_ROW } from "~/ui/recipes/text"

import { NOTIFICATION_TAPPABLE, NOTIFICATION_UNREAD } from "./notifications.recipe"

const LEGACY_CLIENT_PREFIX = "/app/"

const APP_UPDATE_KIND = "app_update_available"

const deepLinkOf = (kind: string, payload: Record<string, unknown>): string | null => {
  const candidate = notificationLink(kind, payload)
  return typeof candidate === "string" && candidate.trim() !== "" ? candidate.trim() : null
}

const destinationOf = (kind: string, payload: Record<string, unknown>): Destination | null => {
  const link = deepLinkOf(kind, payload)
  if (link === null) return null
  const candidate = link.startsWith(LEGACY_CLIENT_PREFIX) ? link.slice(LEGACY_CLIENT_PREFIX.length - 1) : link
  const destination = resolveDestination(candidate, CLIENT_ROUTES)
  return destination.kind === "refused" ? null : destination
}

type ReadableNotification = Readonly<{ id: string; read: boolean }>

type ActionableNotification = ReadableNotification & Readonly<{ kind: string; payload: Record<string, unknown> }>

const NotificationsScreen = (): React.ReactElement => {
  const query = useNotifications()
  const markRead = useMarkNotificationRead()
  const navigate = useNavigate()
  const toast = useToast()
  const pendingReads = useRef<ReadonlySet<string>>(new Set())
  const updatePrompt = useUpdatePrompt()

  const follow = (destination: Destination): void => {
    if (destination.kind === "internal") {
      void navigate(destination.path)
      return
    }
    void openDestination(destination).then((result) => {
      if (result.ok) return
      toast.show("We couldn't open that link on this device.", "error")
    })
  }

  const markOneRead = (id: string): void => {
    if (pendingReads.current.has(id)) return
    pendingReads.current = new Set([...pendingReads.current, id])
    void markRead
      .mutateAsync(id)
      .catch((error: unknown) => {
        toast.show(describeClientFailure(error, "markNotificationRead").message, "error")
      })
      .finally(() => {
        pendingReads.current = new Set(
          [...pendingReads.current].filter((pending) => pending !== id),
        )
      })
  }

  const open = (item: ReadableNotification, destination: Destination): void => {
    if (!item.read) markOneRead(item.id)
    follow(destination)
  }

  const actionOf = (item: ActionableNotification): (() => void) | null => {
    const destination = destinationOf(item.kind, item.payload)
    if (destination !== null) {
      return () => {
        open(item, destination)
      }
    }
    if (item.kind !== APP_UPDATE_KIND || !updatePrompt.isAvailable) return null
    return () => {
      if (!item.read) markOneRead(item.id)
      updatePrompt.open()
    }
  }

  return (
    <Page width="default">
      <PageHeader title="Notifications" description="Updates about your account and investments." />

      <AsyncBoundary
        query={query}
        skeleton={
          <div className={cx(CARD_STACK, FEED_MEASURE)}>
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
            {data.unreadCount === 0 ? null : (
              <span className={COUNT_TEXT}>{`${String(data.unreadCount)} unread`}</span>
            )}
            <div className={cx(CARD_STACK, FEED_MEASURE)}>
              {data.items.map((item) => {
                const action = actionOf(item)
                const category = notificationCategory(item.kind)
                return (
                  <Card key={item.id} tone={item.read ? "default" : "elevated"}>
                    <div className={STACK_SM}>
                      <div
                        className={action === null ? STACK_SM : cx(STACK_SM, NOTIFICATION_TAPPABLE)}
                        onClick={action ?? undefined}
                      >
                        <div className={ROW_BETWEEN}>
                          <span
                            className={cx(ITEM_TITLE, item.read ? undefined : NOTIFICATION_UNREAD)}
                          >
                            {item.title}
                          </span>
                          {category === null ? null : (
                            <Badge tone={category.tone}>{category.label}</Badge>
                          )}
                        </div>
                        <p className={PROSE_SM}>{item.body}</p>
                        <div className={META_ROW}>
                          <span>{formatDateTime(item.createdAt)}</span>
                        </div>
                      </div>
                      <div className={cx(ACTION_ROW, "pt-1")}>
                        {action === null ? null : (
                          <Button tone="secondary" size="sm" onClick={action}>
                            Open
                          </Button>
                        )}
                        {item.read ? null : (
                          <Button
                            tone="ghost"
                            size="sm"
                            loading={markRead.isPending && markRead.variables === item.id}
                            onClick={() => {
                              markOneRead(item.id)
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
