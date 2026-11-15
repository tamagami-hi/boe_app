import { SupportContacts } from "~/features/legal/SupportContacts"
import type { LegalContact } from "~/features/legal/publishedContent"
import { STACK_SM } from "~/ui/recipes/layout"
import { HINT_MUTED } from "~/ui/recipes/text"

const UNPUBLISHED =
  "BeOnEdge has not published a support email yet. Contact the BeOnEdge team that set up your account."

const isEmail = (contact: LegalContact): boolean => contact.href?.startsWith("mailto:") === true

export const LoginHelp = (): React.ReactElement => (
  <section className={STACK_SM} aria-label="Help signing in">
    <p className={HINT_MUTED}>Still cannot sign in? Contact BeOnEdge support.</p>
    <SupportContacts unpublished={UNPUBLISHED} pick={isEmail} />
  </section>
)
