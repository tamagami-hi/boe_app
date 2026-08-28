import { useNavigate } from "react-router-dom"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { useAuthPort } from "~/features/auth/authPort"
import { Button } from "~/ui/primitives/Button"
import { EmptyState } from "~/ui/patterns/EmptyState"

const NotFoundScreen = (): React.ReactElement => {
  const port = useAuthPort()
  const navigate = useNavigate()

  return (
    <Page width="form">
      <PageHeader title="We could not find that page" />
      <EmptyState
        title="This address does not exist"
        description="The link may be out of date, or the screen may have moved."
        action={
          <Button
            onClick={() => {
              void navigate(port.homePath, { replace: true })
            }}
          >
            Go to home
          </Button>
        }
      />
    </Page>
  )
}

export default NotFoundScreen
