import { useNavigate } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { Section } from "~/app/layouts/Section"
import { useSession } from "~/app/providers/SessionProvider"
import type { RoleCode } from "~/domain/permissions"
import { useAuthPort } from "~/features/auth/authPort"
import { InstalledVersionRow } from "~/features/whats-new/InstalledVersionRow"
import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { Button } from "~/ui/primitives/Button"
import { ButtonLink } from "~/ui/primitives/ButtonLink"
import { Card } from "~/ui/primitives/Card"

const roleLabel = (roles: readonly RoleCode[]): string =>
  roles.includes("superadmin") ? "Superadmin" : "Admin"

const AccountScreen = (): React.ReactElement => {
  const { principal, signedOut } = useSession()
  const auth = useAuthPort()
  const navigate = useNavigate()

  const signOut = (): void => {
    void auth.logout().finally(() => {
      signedOut()
      void navigate(auth.loginPath, { replace: true })
    })
  }

  if (principal === null) return <Page width="default">{null}</Page>

  return (
    <Page width="default">
      <PageHeader title="Account" description="Your administrator account on this console." />

      <Card elevated>
        <DataList>
          <DetailRow label="Name">{principal.fullName}</DetailRow>
          <DetailRow label="Email">{principal.email}</DetailRow>
          <DetailRow label="Role">{roleLabel(principal.roles)}</DetailRow>
          <InstalledVersionRow label="App version" />
        </DataList>
      </Card>

      <Section title="What's new" description="What changed in each release of the console.">
        <ButtonLink to="/account/whats-new" tone="secondary">
          Read what's new
        </ButtonLink>
      </Section>

      <Section title="Sign out" description="You will be signed out on this device only.">
        <Button tone="secondary" onClick={signOut}>
          Sign out
        </Button>
      </Section>
    </Page>
  )
}

export default AccountScreen
