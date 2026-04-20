import { prisma } from '../utils/prisma'

export type NotifType =
  // HR/Admin notifications
  | 'LEAVE_APPLIED'
  | 'RESIGNATION_SUBMITTED'
  | 'LWD_REMINDER'
  | 'ALL_CLEARANCE_DONE'
  | 'RESIGNATION_WITHDRAWN'
  | 'LEAVE_CANCELLED_BY_EMP'
  | 'LEAVE_CANCELLATION_REQUEST'
  // Employee notifications
  | 'LEAVE_APPROVED'
  | 'LEAVE_DECLINED'
  | 'LEAVE_AUTO_APPROVED'
  | 'LEAVE_CANCELLATION_APPROVED'
  | 'LEAVE_CANCELLATION_DECLINED'
  | 'RESIGNATION_ACKNOWLEDGED'
  | 'RESIGNATION_ACCEPTED'
  | 'WITHDRAWAL_APPROVED'
  | 'LOAN_CREATED'
  | 'REIMBURSEMENT_ADDED'
  | 'ASSET_ASSIGNED'
  | 'FNF_SETTLEMENT_READY'

export async function getNotifConfig(type: NotifType) {
  const keys = [
    `NOTIF_${type}_TO`,
    `NOTIF_${type}_CC`,
    `NOTIF_${type}_ENABLED`,
    `NOTIF_${type}_SUBJECT`,
  ]
  const records = await prisma.systemConfig.findMany({ where: { key: { in: keys } } })
  const map = Object.fromEntries(records.map(r => [r.key, r.value]))
  const parseList = (v?: string) =>
    (v || '').split(/[,;\n]/).map(s => s.trim()).filter(Boolean)
  return {
    to:      parseList(map[`NOTIF_${type}_TO`]),
    cc:      parseList(map[`NOTIF_${type}_CC`]),
    enabled: (map[`NOTIF_${type}_ENABLED`] ?? 'true').toLowerCase() !== 'false',
    subject: map[`NOTIF_${type}_SUBJECT`] || '',
  }
}

export function renderTemplate(tpl: string, vars: Record<string, string>) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '')
}
