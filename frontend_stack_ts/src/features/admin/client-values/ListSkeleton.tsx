import { Card } from "~/ui/primitives/Card"
import { Skeleton } from "~/ui/primitives/Feedback"

export const ListSkeleton = (): React.ReactElement => (
  <Card>
    <Skeleton height="1rem" width="45%" />
    <Skeleton height="1rem" width="70%" />
  </Card>
)
