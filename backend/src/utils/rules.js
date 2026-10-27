import { dayType } from './dates.js';

export const hhmmToMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
/** Late = strictly after office start + grace (09:15:00 is on time, 09:15:01 is late). */
export const isLate = (secs, officeStart, graceMinutes) => secs > (hhmmToMin(officeStart) + graceMinutes) * 60;
export const minutesBetween = (a, b) => Math.max(0, Math.floor((b - a) / 60000));
/** Half-day = fewer than halfDayHours worked (exactly 5h is a full day). Overrides late. */
export const finalStatus = ({ late, workedMinutes, halfDayHours = 5 }) => (workedMinutes < halfDayHours * 60 ? 'half_day' : late ? 'late' : 'present');

/** Status shown for one employee on one date. Absent = working day, in the past, no record, no approved leave. */
export function classifyDay({ dateKey, todayKey, joiningKey, record, onLeave, type }) {
  if (dateKey < joiningKey) return 'n/a';
  if (record) return record.status;
  if (onLeave) return 'on_leave';
  if (type !== 'working') return type;
  if (dateKey > todayKey) return 'future';
  return dateKey === todayKey ? 'not_checked_in' : 'absent';
}

export const exceedsQuota = (quota, committed, requested) => quota != null && committed + requested > quota;
export const remaining = (quota, used, pending) => (quota == null ? null : Math.max(0, quota - used - pending));
export { dayType };
