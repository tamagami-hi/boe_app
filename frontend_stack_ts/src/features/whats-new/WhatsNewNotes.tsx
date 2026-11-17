import { NOTES_GROUP, NOTES_HEADING, NOTES_ITEMS, NOTES_ROOT } from "./whatsNew.recipe"
import { forPlatform, notePlatform, type WhatsNewEntry } from "./whatsNewEntry"

export type WhatsNewNotesProps = Readonly<{ entry: WhatsNewEntry }>

export const WhatsNewNotes = ({ entry }: WhatsNewNotesProps): React.ReactElement => (
  <div className={NOTES_ROOT}>
    {forPlatform(entry, notePlatform()).sections.map((section) => (
      <div key={section.heading} className={NOTES_GROUP}>
        <h3 className={NOTES_HEADING}>{section.heading}</h3>
        <ul className={NOTES_ITEMS}>
          {section.items.map((item) => (
            <li key={item.text}>{item.text}</li>
          ))}
        </ul>
      </div>
    ))}
  </div>
)
