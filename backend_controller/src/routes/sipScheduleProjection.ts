import { z } from "zod"

import {
  SIP_MONTH_PATTERN,
  indiaCurrentMonth,
  scheduleProgress,
} from "../domain/admin/sipScheduleMonths.js"
import type { AdminSipScheduleRow } from "../repositories/adminSipScheduleRepository.js"

export const sipMonthSchema = z.string().regex(SIP_MONTH_PATTERN, "must be a month written as YYYY-MM")

const iso = (value: Date | string): string => new Date(value).toISOString()

export const mapAdminSipSchedule = (row: AdminSipScheduleRow, now: Date): Record<string, unknown> => {
  const progress = scheduleProgress({ ...row, currentMonth: indiaCurrentMonth(now) })
  return {
    scheduleId: row.id,
    userId: row.userId,
    clientName: row.clientName,
    fundId: row.fundId,
    fundName: row.fundName,
    monthlyAmountPaise: row.monthlyAmountPaise,
    startMonth: row.startMonth,
    endMonth: progress.endMonth,
    monthCount: row.monthCount,
    state: row.state,
    version: Number(row.version),
    monthsPaid: progress.monthsPaid,
    monthsDue: progress.monthsDue,
    nextUnpaidMonth: progress.nextUnpaidMonth,
    paidMonths: [...row.paidMonths],
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    closedAt: row.closedAt === null ? null : iso(row.closedAt),
  }
}

export const mapClientSipSchedule = (row: AdminSipScheduleRow, now: Date): Record<string, unknown> => ({
  scheduleId: row.id,
  fundId: row.fundId,
  fundName: row.fundName,
  monthlyAmountPaise: row.monthlyAmountPaise,
  startMonth: row.startMonth,
  totalMonths: row.monthCount,
  monthsPaid: scheduleProgress({ ...row, currentMonth: indiaCurrentMonth(now) }).monthsPaid,
  state: row.state,
})
