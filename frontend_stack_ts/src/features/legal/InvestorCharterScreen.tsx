import { LegalDocumentScreen } from "./LegalDocumentScreen"

const FALLBACK =
  "The investor charter has not been published to this environment yet. It sets out what you can expect from BeOnEdge, what we expect from you, and where to take a question we have not answered. Until it is published, our support team can answer the same questions directly."

const InvestorCharterScreen = (): React.ReactElement => (
  <LegalDocumentScreen
    kind="investor-charter"
    title="Investor charter"
    description="Your rights and responsibilities as an investor, published by BeOnEdge."
    fallback={FALLBACK}
  />
)

export default InvestorCharterScreen
