export type ExportPage<TItem> = Readonly<{
  items: readonly TItem[]
  nextCursor: string | null
  hasMore: boolean
}>

export const MAX_EXPORT_PAGES = 2_000

export class ExportStoppedError extends Error {
  public readonly pageNumber: number
  public readonly reason: unknown

  public constructor(pageNumber: number, reason: unknown) {
    super(`The export stopped at page ${String(pageNumber)}`)
    this.name = "ExportStoppedError"
    this.pageNumber = pageNumber
    this.reason = reason
  }
}

const readPage = async <TItem>(
  fetchPage: (cursor: string | undefined) => Promise<ExportPage<TItem>>,
  cursor: string | undefined,
  pageNumber: number,
): Promise<ExportPage<TItem>> => {
  try {
    return await fetchPage(cursor)
  } catch (error) {
    throw new ExportStoppedError(pageNumber, error)
  }
}

export const collectPages = async <TItem>(
  fetchPage: (cursor: string | undefined) => Promise<ExportPage<TItem>>,
  onProgress: (loaded: number) => void,
): Promise<readonly TItem[]> => {
  const seenCursors = new Set<string>()
  const collected: TItem[] = []
  let cursor: string | undefined
  for (let pageNumber = 1; pageNumber <= MAX_EXPORT_PAGES; pageNumber += 1) {
    const page = await readPage(fetchPage, cursor, pageNumber)
    collected.push(...page.items)
    onProgress(collected.length)
    if (!page.hasMore) return collected
    if (page.nextCursor === null || seenCursors.has(page.nextCursor)) {
      throw new ExportStoppedError(pageNumber, new Error("The next page cursor did not advance"))
    }
    seenCursors.add(page.nextCursor)
    cursor = page.nextCursor
  }
  throw new ExportStoppedError(MAX_EXPORT_PAGES, new Error("The export has more pages than allowed"))
}
