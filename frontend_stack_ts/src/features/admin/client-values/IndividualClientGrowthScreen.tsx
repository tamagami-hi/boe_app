import { useState } from "react"

import { Page } from "~/app/layouts/Page"
import { PageHeader } from "~/app/layouts/PageHeader"

import { IndividualGrowthForm } from "./IndividualGrowthForm"
import { InvestorPicker, type InvestorChoice } from "./InvestorPicker"
import { useLinkedInvestor } from "./linkedInvestor"
import { useFollowedLink, useLinkedRecord } from "./linkedRecord"

const IndividualClientGrowthScreen = (): React.ReactElement => {
  const link = useLinkedRecord()
  const { linked, relink } = link
  const [userId, setUserId] = useState(linked.userId)
  const [formKey, setFormKey] = useState(linked.userId)
  const [picked, setPicked] = useState<InvestorChoice>({ userId: "", label: "" })
  const [isInvestorLocked, setInvestorLocked] = useState(false)
  const pickedLabel = picked.userId === userId ? picked.label : ""
  const investor = useLinkedInvestor(userId, pickedLabel)
  const formUserId = investor.missing ? "" : userId

  useFollowedLink(link, userId, isInvestorLocked, (next) => {
    setUserId(next)
    if (next !== "") setFormKey(next)
    else if (investor.missing) setFormKey("")
  })

  return (
    <Page width="default">
      <PageHeader
        title="Adjust one investor"
        description="Appends a growth entry against one position. A rate is measured against the amount invested, so it does not compound; the amount invested itself never moves. Read the projected value before committing. The value is worked out again when you commit, and that result is what gets recorded."
      />
      <IndividualGrowthForm
        key={investor.missing ? "" : formKey}
        userId={formUserId}
        investorLabel={investor.label === "" ? "The selected investor" : investor.label}
        initialFundId={formUserId === linked.userId ? linked.fundId : ""}
        onFundChange={(fundId) => {
          relink({ userId, fundId })
        }}
        onInvestorLock={setInvestorLocked}
        renderPicker={(disabled) => (
          <>
            <InvestorPicker
              userId={userId}
              initialQuery={pickedLabel}
              hint="Search by name, email or phone. Only investors with a holding can be adjusted."
              disabled={disabled}
              onChange={(choice) => {
                setPicked(choice)
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
