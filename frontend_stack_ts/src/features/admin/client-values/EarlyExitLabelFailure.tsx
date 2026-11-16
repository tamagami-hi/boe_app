import type { UseQueryResult } from "@tanstack/react-query"

import { Button } from "~/ui/primitives/Button"
import { Alert } from "~/ui/primitives/Feedback"

export const EARLY_EXIT_LABEL = "Early exit"

export type EarlyExitLabelFailureProps = Readonly<{ query: Pick<UseQueryResult, "isError" | "isFetching" | "refetch"> }>

export const EarlyExitLabelFailure = ({ query }: EarlyExitLabelFailureProps): React.ReactElement | null =>
  query.isError ? (
    <Alert
      tone="warning"
      title="Early exits not loaded"
      action={
        <Button
          size="sm"
          tone="secondary"
          loading={query.isFetching}
          onClick={() => {
            void query.refetch()
          }}
        >
          Try again
        </Button>
      }
    >
      It could not be checked which withdrawals are early exits, so an early exit shows here as a plain withdrawal.
    </Alert>
  ) : null
