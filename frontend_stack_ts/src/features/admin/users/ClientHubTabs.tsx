import { useState } from "react"
import { useSearchParams } from "react-router-dom"

import { Section } from "~/app/layouts/Section"
import { useSession } from "~/app/providers/SessionProvider"
import { TabPanel, Tabs, type TabItem } from "~/ui/primitives/Toggle"

import { ClientActivityTab } from "./ClientActivityTab"
import { ClientEmailsTab } from "./ClientEmailsTab"
import { ClientLedgerTab } from "./ClientLedgerTab"
import { ClientMaturityTab } from "./ClientMaturityTab"
import { ClientSupportTab } from "./ClientSupportTab"
import { UserLoginEventsList } from "./UserLoginEventsList"

type HubTab = "ledger" | "maturity" | "emails" | "support" | "sign-ins" | "activity"

const TABS_ID = "client-hub-records"

type TabChoice = Readonly<{ requested: string | null; value: string | null }>

type Props = Readonly<{ userId: string; isClient: boolean }>

export const ClientHubTabs = ({ userId, isClient }: Props): React.ReactElement | null => {
  const { hasAnyPermission } = useSession()
  const [searchParams] = useSearchParams()
  const requested = searchParams.get("tab")
  const [choice, setChoice] = useState<TabChoice>({ requested, value: requested })
  if (choice.requested !== requested) setChoice({ requested, value: requested })
  const selected = choice.requested === requested ? choice.value : requested
  const canReadValues = isClient && hasAnyPermission(["client_position.write", "client_values.read"])
  const items: readonly TabItem<HubTab>[] = [
    ...(canReadValues
      ? [
          { value: "ledger" as const, label: "Ledger" },
          { value: "maturity" as const, label: "Maturity" },
        ]
      : []),
    ...(hasAnyPermission(["email_deliveries.read", "email_deliveries.read_masked"])
      ? [{ value: "emails" as const, label: "Emails" }]
      : []),
    ...(hasAnyPermission(["support.read"]) ? [{ value: "support" as const, label: "Support" }] : []),
    ...(hasAnyPermission(["users.read"]) ? [{ value: "sign-ins" as const, label: "Sign-ins" }] : []),
    ...(hasAnyPermission(["audit.read"]) ? [{ value: "activity" as const, label: "Activity log" }] : []),
  ]
  const active = items.find((item) => item.value === selected)?.value ?? items[0]?.value
  if (active === undefined) return null

  return (
    <Section title="Records" description="Each tab reads live from the backend when you open it.">
      <Tabs
        id={TABS_ID}
        label="Client records"
        value={active}
        items={items}
        onChange={(value) => {
          setChoice({ requested, value })
        }}
      />
      <TabPanel id={TABS_ID} value={active}>
        {active === "ledger" ? <ClientLedgerTab userId={userId} /> : null}
        {active === "maturity" ? <ClientMaturityTab userId={userId} /> : null}
        {active === "emails" ? <ClientEmailsTab userId={userId} /> : null}
        {active === "support" ? <ClientSupportTab userId={userId} /> : null}
        {active === "sign-ins" ? <UserLoginEventsList userId={userId} /> : null}
        {active === "activity" ? <ClientActivityTab userId={userId} /> : null}
      </TabPanel>
    </Section>
  )
}
