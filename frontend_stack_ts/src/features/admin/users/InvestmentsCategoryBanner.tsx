import { isApiError, isSessionEnded } from "~/api/errors"
import { useSession } from "~/app/providers/SessionProvider"
import { clientLedgerPath, cleanupCountsOf, type CleanupCounts } from "~/features/admin/client-values/investmentCleanup"
import { useClientInvestments } from "~/features/admin/client-values/investmentCleanupQueries"
import { Button } from "~/ui/primitives/Button"
import { ButtonLink } from "~/ui/primitives/ButtonLink"
import { Alert } from "~/ui/primitives/Feedback"

const plural = (count: number, one: string, many: string): string => `${String(count)} ${count === 1 ? one : many}`

const bannerText = ({ uncategorised, fundsWithUncategorised, fundsNeedingSplit }: CleanupCounts): string => {
  const recordings =
    uncategorised === 0
      ? []
      : [
          `${plural(uncategorised, "investment", "investments")} in ${plural(fundsWithUncategorised, "fund", "funds")} ${uncategorised === 1 ? "needs" : "need"} a category before this client's breakdown can show.`,
        ]
  const splits =
    fundsNeedingSplit === 0
      ? []
      : [
          `The earlier growth of ${plural(fundsNeedingSplit, "fund", "funds")} needs a confirmed split between investments.`,
        ]
  return [...recordings, ...splits].join(" ")
}

const BannerReading = ({ userId }: Readonly<{ userId: string }>): React.ReactElement | null => {
  const investments = useClientInvestments(userId)
  const { data, error } = investments
  if (data === undefined) {
    if (error === null || isSessionEnded(error)) return null
    if (isApiError(error) && error.code === "AUTHORIZATION_DENIED") return null
    return (
      <Alert
        tone="warning"
        title="Categories not checked"
        action={
          <Button
            size="sm"
            tone="secondary"
            loading={investments.isFetching}
            onClick={() => {
              void investments.refetch()
            }}
          >
            Try again
          </Button>
        }
      >
        It could not be checked whether this client&apos;s investments need a category.
      </Alert>
    )
  }
  const counts = cleanupCountsOf(data)
  if (counts.uncategorised === 0 && counts.fundsNeedingSplit === 0) return null
  return (
    <Alert
      tone="warning"
      title="Investments to categorise"
      action={
        <ButtonLink to={clientLedgerPath(userId)} tone="secondary" size="sm" trailing>
          Open the Ledger tab
        </ButtonLink>
      }
    >
      {bannerText(counts)}
    </Alert>
  )
}

export type InvestmentsCategoryBannerProps = Readonly<{ userId: string }>

export const InvestmentsCategoryBanner = ({ userId }: InvestmentsCategoryBannerProps): React.ReactElement | null => {
  const { hasAnyPermission } = useSession()
  return hasAnyPermission(["client_values.read"]) ? <BannerReading userId={userId} /> : null
}
