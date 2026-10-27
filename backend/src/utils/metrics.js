import { round2 } from './salary.js';

/** Percentage with 2 decimals, or null when the denominator is 0 (empty data never divides by zero). */
export const pct = (n, d) => (d > 0 ? round2((n / d) * 100) : null);

const c = (o, k) => o?.[k] || 0;
/** attendance rate = (present + late + missing_checkout + 0.5 x half_day) / (working-day records - on_leave) */
export function attendanceRate(t) {
  const denom = c(t, 'present') + c(t, 'late') + c(t, 'half_day') + c(t, 'missing_checkout') + c(t, 'absent');
  return pct(c(t, 'present') + c(t, 'late') + c(t, 'missing_checkout') + 0.5 * c(t, 'half_day'), denom);
}
/** late % = late / (present + late) */
export const latePct = (t) => pct(c(t, 'late'), c(t, 'present') + c(t, 'late'));
/** absenteeism = absent days / expected working days (all in-service working days, leave days included) */
export const absenteeism = (t) => pct(c(t, 'absent'), c(t, 'present') + c(t, 'late') + c(t, 'half_day') + c(t, 'missing_checkout') + c(t, 'absent') + c(t, 'on_leave'));
/** leave utilization = approved leave days / quota (quota x headcount for a company-wide figure) */
export const leaveUtilization = (days, quota, headcount = 1) => (quota == null ? null : pct(days, quota * headcount));
/** attrition % (YTD) = leavers since 1 Jan / average of (headcount on 31 Dec prior year, headcount at range end) */
export const attritionPct = (leavers, startHeadcount, endHeadcount) => pct(leavers, (startHeadcount + endHeadcount) / 2);
