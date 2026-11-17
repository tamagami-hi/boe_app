import { isNative } from "~/platform/capacitor"

export type WhatsNewPlatform = "android" | "web"

export type WhatsNewItem = Readonly<{ text: string; platform?: WhatsNewPlatform }>

export type WhatsNewHeading = "New" | "Improved" | "Fixed"

export type WhatsNewSection = Readonly<{ heading: WhatsNewHeading; items: readonly WhatsNewItem[] }>

export type WhatsNewEntry = Readonly<{ id: string; sections: readonly WhatsNewSection[] }>

export type WhatsNewNotes = readonly [WhatsNewEntry, ...WhatsNewEntry[]]

export const notePlatform = (): WhatsNewPlatform => (isNative() ? "android" : "web")

const showsOn = (item: WhatsNewItem, platform: WhatsNewPlatform): boolean =>
  item.platform === undefined || item.platform === platform

export const unseenEntries = (notes: WhatsNewNotes, lastSeenId: string | null): WhatsNewNotes | null => {
  if (lastSeenId === null) return notes
  const seenAt = notes.findIndex((entry) => entry.id === lastSeenId)
  if (seenAt === -1) return [notes[0]]
  const [newest, ...older] = notes.slice(0, seenAt)
  return newest === undefined ? null : [newest, ...older]
}

export const forPlatform =(entry: WhatsNewEntry, platform: WhatsNewPlatform): WhatsNewEntry => ({
  id: entry.id,
  sections: entry.sections
    .map((section) => ({
      heading: section.heading,
      items: section.items.filter((item) => showsOn(item, platform)),
    }))
    .filter((section) => section.items.length > 0),
})
