import { NOTES_GROUP, NOTES_HEADING, NOTES_ITEMS, NOTES_ROOT } from "./whatsNew.recipe"
import { forPlatform, notePlatform, type WhatsNewEntry } from "./whatsNewEntry"

export type WhatsNewNotesProps = Readonly<{ entry: WhatsNewEntry; headingLevel?: "h3" | "h4" }>

export const WhatsNewNotes = ({ entry, headingLevel: Heading = "h3" }: WhatsNewNotesProps): React.ReactElement => (
  <div className={NOTES_ROOT}>
    {forPlatform(entry, notePlatform()).sections.map((section) => (
      <div key={section.heading} className={NOTES_GROUP}>
        <Heading className={NOTES_HEADING}>{section.heading}</Heading>
        <ul className={NOTES_ITEMS}>
          {section.items.map((item) => (
            <li key={item.text}>{item.text}</li>
          ))}
        </ul>
      </div>
    ))}
  </div>
)
