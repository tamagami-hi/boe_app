import { useEffect, useRef } from "react"
import { useSearchParams } from "react-router-dom"

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

export type LinkedRecord = Readonly<{ userId: string; fundId: string }>

export type LinkedRecordState = Readonly<{
  linked: LinkedRecord
  relink: (next: LinkedRecord) => void
}>

const idOf = (value: string | null): string => (value !== null && UUID_PATTERN.test(value) ? value.toLowerCase() : "")

export const linkedRecordOf = (params: URLSearchParams): LinkedRecord => {
  const userId = idOf(params.get("userId"))
  return { userId, fundId: userId === "" ? "" : idOf(params.get("fundId")) }
}

export const recordLinkQuery = ({ userId, fundId }: LinkedRecord): string => {
  if (userId === "") return ""
  const params = new URLSearchParams({ userId })
  if (fundId !== "") params.set("fundId", fundId)
  return `?${params.toString()}`
}

export const useLinkedRecord = (): LinkedRecordState => {
  const [searchParams, setSearchParams] = useSearchParams()
  return {
    linked: linkedRecordOf(searchParams),
    relink: (next) => {
      setSearchParams(recordLinkQuery(next), { replace: true })
    },
  }
}

export const useFollowedLink = (
  { linked, relink }: LinkedRecordState,
  shownUserId: string,
  isLocked: boolean,
  follow: (userId: string) => void,
): void => {
  const shownFundId = useRef(linked.fundId)
  const latest = useRef({ relink, follow })
  latest.current = { relink, follow }

  useEffect(() => {
    if (linked.userId === shownUserId) {
      shownFundId.current = linked.fundId
      return
    }
    if (isLocked) latest.current.relink({ userId: shownUserId, fundId: shownFundId.current })
    else latest.current.follow(linked.userId)
  }, [linked.userId, linked.fundId, shownUserId, isLocked])
}
