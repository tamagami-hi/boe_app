import { useState } from "react"

import { Section } from "~/app/layouts/Section"
import { useSession } from "~/app/providers/SessionProvider"
import { TabPanel, Tabs, type TabItem } from "~/ui/primitives/Toggle"

import { ClientEmailsTab } from "./ClientEmailsTab"
import { ClientLedgerTab } from "./ClientLedgerTab"
import { ClientMaturityTab } from "./ClientMaturityTab"
import { ClientSupportTab } from "./ClientSupportTab"
import { UserLoginEventsList } from "./UserLoginEventsList"

type HubTab = "ledger" | "maturity" | "emails" | "support" | "sign-ins"

const TABS_ID = "client-hub-records"

type Props = Readonly<{ userId: string; isClient: boolean }>

export const ClientHubTabs = ({ userId, isClient }: Props): React.ReactElement | null => {
  const { hasAnyPermission } = useSession()
  const [selected, setSelected] = useState<HubTab | null>(null)
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
  ]
  const active = items.find((item) => item.value === selected)?.value ?? items[0]?.value
  if (active === undefined) return null

  return (
    <Section title="Records" description="Each tab reads live from the backend when you open it.">
      <Tabs id={TABS_ID} label="Client records" value={active} items={items} onChange={setSelected} />
      <TabPanel id={TABS_ID} value={active}>
        {active === "ledger" ? <ClientLedgerTab userId={userId} /> : null}
        {active === "maturity" ? <ClientMaturityTab userId={userId} /> : null}
        {active === "emails" ? <ClientEmailsTab userId={userId} /> : null}
        {active === "support" ? <ClientSupportTab userId={userId} /> : null}
        {active === "sign-ins" ? <UserLoginEventsList userId={userId} /> : null}
      </TabPanel>
    </Section>
  )
}
