import { Prose } from "~/ui/patterns/DataList"
import { CARD_TITLE, META_TEXT } from "~/ui/recipes/text"

import { DOC_ITEMS, DOC_LIST, DOC_SECTION } from "./legal.recipe"
import { PublishedContactList } from "./PublishedContactList"
import type { LegalSection } from "./publishedContent"

export type LegalSectionsProps = Readonly<{ sections: readonly LegalSection[] }>

export const LegalSections = ({ sections }: LegalSectionsProps): React.ReactElement | null =>
  sections.length === 0 ? null : (
    <div className={DOC_LIST}>
      {sections.map((section) => (
        <div key={section.heading} className={DOC_SECTION}>
          <h2 className={CARD_TITLE}>{section.heading}</h2>
          {section.body === null ? null : <Prose>{section.body}</Prose>}
          {section.items.length === 0 ? null : (
            <ul className={DOC_ITEMS}>
              {section.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
          {section.note === null ? null : <span className={META_TEXT}>{section.note}</span>}
          {section.contacts.length === 0 ? null : <PublishedContactList contacts={section.contacts} />}
        </div>
      ))}
    </div>
  )
