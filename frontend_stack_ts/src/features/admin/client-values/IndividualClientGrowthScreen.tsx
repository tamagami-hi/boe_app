import { useState } from "react"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"

import { IndividualGrowthForm } from "./IndividualGrowthForm"
import { InvestorPicker } from "./InvestorPicker"
import { useLinkedInvestor } from "./linkedInvestor"
import { useLinkedRecord } from "./linkedRecord"

const IndividualClientGrowthScreen = (): React.ReactElement => {
  const { linked, relink } = useLinkedRecord()
  const [userId, setUserId] = useState(linked.userId)
  const [formKey, setFormKey] = useState(linked.userId)
  const [pickedLabel, setPickedLabel] = useState("")
  const investor = useLinkedInvestor(userId, pickedLabel)
  const formUserId = investor.missing ? "" : userId

  return (
    <Page width="default">
      <PageHeader
        title="Adjust one investor"
        description="Appends a growth entry against one position. A rate is measured against the amount invested, so it does not compound; the amount invested itself never moves. Read the projected value before committing — the server recalculates it authoritatively and its response is the truth."
      />
      <IndividualGrowthForm
        key={investor.missing ? "" : formKey}
        userId={formUserId}
        investorLabel={investor.label === "" ? "The selected investor" : investor.label}
        initialFundId={formUserId === linked.userId ? linked.fundId : ""}
        onFundChange={(fundId) => {
          relink({ userId, fundId })
        }}
        renderPicker={(disabled) => (
          <>
            <InvestorPicker
              userId={userId}
              initialQuery={pickedLabel}
              hint="Search by name, email or phone. Only investors with a holding can be adjusted."
              disabled={disabled}
              onChange={(choice) => {
                setUserId(choice.userId)
                setPickedLabel(choice.label)
                if (choice.userId !== "") setFormKey(choice.userId)
                relink({ userId: choice.userId, fundId: "" })
              }}
            />
            {investor.notice}
          </>
        )}
      />
    </Page>
  )
}

export default IndividualClientGrowthScreen
