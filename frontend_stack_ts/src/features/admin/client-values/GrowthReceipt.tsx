import type { appendAdminIndividualClientGrowth } from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { Section } from "~/app/layouts/Section"
import { formatDate } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { DataList, DetailRow } from "~/ui/patterns/DataList"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { Card } from "~/ui/primitives/Card"
import { ADMIN_CODE } from "~/ui/recipes/admin"

export type GrowthReceiptProps = Readonly<{
  receipt: DataOf<typeof appendAdminIndividualClientGrowth>
}>

export const GrowthReceipt = ({ receipt }: GrowthReceiptProps): React.ReactElement => (
  <Section title="What was written">
    <Card>
      <DataList>
        <DetailRow label="Batch">
          <span className={ADMIN_CODE}>{receipt.batchId}</span>
        </DetailRow>
        <DetailRow label="Entry">
          <span className={ADMIN_CODE}>{receipt.entryId}</span>
        </DetailRow>
        <DetailRow label="Amount invested">
          <MoneyValue amount={toPaise(receipt.principalPaise)} size="sm" showDecimals />
        </DetailRow>
        <DetailRow label="Value before">
          <MoneyValue amount={toPaise(receipt.beforePaise)} size="sm" showDecimals />
        </DetailRow>
        <DetailRow label="Adjustment">
          <MoneyValue amount={toPaise(receipt.deltaPaise)} size="sm" tone="signed" showSign showDecimals />
        </DetailRow>
        <DetailRow label="Value after">
          <MoneyValue amount={toPaise(receipt.afterPaise)} size="sm" showDecimals />
        </DetailRow>
        <DetailRow label="Effective date">{formatDate(receipt.effectiveDate)}</DetailRow>
      </DataList>
    </Card>
  </Section>
)
