import type { Transaction, User } from "../../db/repositories.js"
import { AppError } from "../../http/errorCatalog.js"
import type { AdminSipScheduleRepository } from "../../repositories/adminSipScheduleRepository.js"
import { queueInvestmentRecordedMail, type InvestmentRecordedMailDeps } from "../email/investmentRecordedMail.js"
import { queueOneTimeInvestmentMail, queueSipPaymentMail } from "../email/recordedCategoryMail.js"
import type { AssignedRecordingCategory, RecordingCategory } from "../shared/recordingCategory.js"
import type { PreparedSipMonthLink } from "./sipMonthLink.js"
import { indiaCurrentMonth, monthsCoveredThrough, scheduleProgress } from "./sipScheduleMonths.js"

export interface RecordingMailDeps extends InvestmentRecordedMailDeps {
  readonly sipScheduleRepository: Pick<AdminSipScheduleRepository, "findForUser">
  readonly clock: () => Date
}

export interface RecordingMailInput {
  readonly recipient: Pick<User, "id" | "email_normalized" | "full_name" | "email_revision">
  readonly entryId: string
  readonly fundName: string
  readonly amountPaise: bigint
  readonly effectiveDate: string
  readonly requestId: string
  readonly category: RecordingCategory
  readonly assignedCategory: AssignedRecordingCategory | null
  readonly sipLink: PreparedSipMonthLink | null
}

const queueSipMail = async (
  tx: Transaction,
  deps: RecordingMailDeps,
  input: RecordingMailInput,
  link: PreparedSipMonthLink,
): Promise<void> => {
  const schedule = await deps.sipScheduleRepository.findForUser(tx, { userId: link.userId, scheduleId: link.scheduleId })
  if (schedule === null) throw new AppError("INTERNAL_ERROR")
  const progress = scheduleProgress({ ...schedule, currentMonth: indiaCurrentMonth(deps.clock()) })
  await queueSipPaymentMail(tx, deps, {
    recipient: input.recipient,
    entryId: input.entryId,
    fundName: input.fundName,
    amountPaise: input.amountPaise,
    effectiveDate: input.effectiveDate,
    requestId: input.requestId,
    scheduleId: link.scheduleId,
    sipMonth: link.month,
    monthNumber: monthsCoveredThrough(schedule.startMonth, link.month),
    monthCount: schedule.monthCount,
    nextMonth: progress.nextUnpaidMonth,
  })
}

export const queueRecordingMail = async (
  tx: Transaction,
  deps: RecordingMailDeps,
  input: RecordingMailInput,
): Promise<void> => {
  if (input.category === "correction") return
  if (input.sipLink !== null) {
    await queueSipMail(tx, deps, input, input.sipLink)
    return
  }
  const base = {
    recipient: input.recipient,
    entryId: input.entryId,
    fundName: input.fundName,
    amountPaise: input.amountPaise,
    effectiveDate: input.effectiveDate,
    requestId: input.requestId,
  }
  if (input.assignedCategory === "one_time") {
    await queueOneTimeInvestmentMail(tx, deps, base)
    return
  }
  await queueInvestmentRecordedMail(tx, deps, { ...base, category: input.category })
}
