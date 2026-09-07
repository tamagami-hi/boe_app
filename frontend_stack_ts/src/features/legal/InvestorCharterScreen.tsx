import { LegalDocumentScreen } from "./LegalDocumentScreen"

const FALLBACK =
  "The investor charter is not available yet. Our support team can answer any question it would cover in the meantime."

const InvestorCharterScreen = (): React.ReactElement => (
  <LegalDocumentScreen
    kind="investor-charter"
    title="Investor charter"
    description="Your rights and responsibilities as an investor, published by BeOnEdge."
    fallback={FALLBACK}
  />
)

export default InvestorCharterScreen
