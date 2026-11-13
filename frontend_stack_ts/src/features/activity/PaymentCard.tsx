import { Link } from "react-router-dom"

import type { listClientPayments } from "~/api/generated/operations"
import type { DataOf } from "~/api/http"
import { formatDate, formatDateTime } from "~/domain/dates"
import { toPaise } from "~/domain/money"
import { paymentPartnerName } from "~/domain/provider"
import type { StatusPresentation } from "~/domain/status"
import { MoneyValue } from "~/ui/patterns/MoneyValue"
import { StatusBadge } from "~/ui/patterns/StatusBadge"
import { Card } from "~/ui/primitives/Card"
import { ITEM_TITLE } from "~/ui/recipes/datalist"
import { CARD_LINK } from "~/ui/recipes/surface"
import { META_MUTED } from "~/ui/recipes/text"

import { ROW, ROW_LEFT, ROW_RIGHT } from "./activity.recipe"

export type ListedPayment = DataOf<typeof listClientPayments>["items"][number]

const paymentWhen = (payment: ListedPayment): string =>
  payment.provider === null
    ? formatDate(payment.succeededAt ?? payment.createdAt)
    : formatDateTime(payment.createdAt)

export type PaymentCardProps = Readonly<{
  payment: ListedPayment
  fundName: string
  status: StatusPresentation
}>

export const PaymentCard = ({ payment, fundName, status }: PaymentCardProps): React.ReactElement => {
  const partner = paymentPartnerName(payment.provider)
  return (
    <Link to={`/activity/payments/${payment.id}`} className={CARD_LINK}>
      <Card>
        <div className={ROW}>
          <div className={ROW_LEFT}>
            <StatusBadge status={status} />
            <span className={ITEM_TITLE}>{fundName}</span>
            <span className={META_MUTED}>{paymentWhen(payment)}</span>
          </div>
          <div className={ROW_RIGHT}>
            <MoneyValue amount={toPaise(payment.amountPaise)} size="md" />
            {partner === null ? null : <span className={META_MUTED}>{partner}</span>}
          </div>
        </div>
      </Card>
    </Link>
  )
}
