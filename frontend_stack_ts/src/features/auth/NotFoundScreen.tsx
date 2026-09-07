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
      <PageHeader title="Page not found" />
      <EmptyState
        title="We could not find that page"
        description="The link may be out of date."
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
