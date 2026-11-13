import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"
import { ButtonLink } from "~/ui/primitives/ButtonLink"
import { HONESTY_TEXT } from "~/ui/recipes/text"

export const INVESTMENTS_RECORDED_NOTE =
  "Your investments are recorded by the BeOnEdge team and appear in your portfolio."

export const INVESTMENTS_RECORDED_HERE =
  "Your investments are recorded by the BeOnEdge team and appear here."

export const InvestmentsRecordedNote = (): React.ReactElement => (
  <p className={HONESTY_TEXT}>{INVESTMENTS_RECORDED_NOTE}</p>
)

export type PaymentsOffPageProps = Readonly<{ title: string }>

export const PaymentsOffPage = ({ title }: PaymentsOffPageProps): React.ReactElement => (
  <Page width="form">
    <PageHeader title={title} description={INVESTMENTS_RECORDED_NOTE} />
    <ButtonLink to="/portfolio" tone="secondary" trailing>
      See my portfolio
    </ButtonLink>
  </Page>
)
