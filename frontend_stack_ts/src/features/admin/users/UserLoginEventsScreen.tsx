import { useParams } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"

import { UserLoginEventsList } from "./UserLoginEventsList"

const UserLoginEventsScreen = (): React.ReactElement => {
  const { userId = "" } = useParams()

  return (
    <Page width="wide">
      <PageHeader
        title="Sign-in history"
        description="Every sign-in attempt recorded against this account, successful or not, newest first."
      />
      <UserLoginEventsList userId={userId} />
    </Page>
  )
}

export default UserLoginEventsScreen
