// All "business dates" are YYYY-MM-DD strings in the company timezone; instants are real Dates.
const fmt = (tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

export function localParts(date, tz = 'Asia/Karachi') {
  const o = {};
  for (const p of fmt(tz).formatToParts(date)) o[p.type] = p.value;
  const [y, m, d, h, mi, s] = [+o.year, +o.month, +o.day, +o.hour, +o.minute, +o.second];
  return { dateKey: `${o.year}-${o.month}-${o.day}`, secs: h * 3600 + mi * 60 + s, y, m, d, h, mi, s };
}
// Local wall-clock "HH:MM" on a business date -> UTC instant (valid for fixed-offset zones such as Asia/Karachi).
export function zonedToUtc(dateKey, hhmm, tz = 'Asia/Karachi') {
  const guess = new Date(`${dateKey}T${hhmm}:00Z`);
  const p = localParts(guess, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return new Date(guess.getTime() - (asUtc - guess.getTime()));
}
export const isDateKey = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);
export const addDays = (k, n) => { const d = new Date(`${k}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const dow = (k) => new Date(`${k}T00:00:00Z`).getUTCDay();
export function* eachDay(a, b) { for (let k = a; k <= b; k = addDays(k, 1)) yield k; }
export const dayType = (k, weekend, holidays) => (holidays.has(k) ? 'holiday' : weekend.includes(dow(k)) ? 'weekend' : 'working');
export const isWorkingDay = (k, weekend, holidays) => dayType(k, weekend, holidays) === 'working';
export function countWorkingDays(a, b, weekend, holidays) {
  let n = 0;
  for (const k of eachDay(a, b)) if (isWorkingDay(k, weekend, holidays)) n++;
  return n;
}
export const rangesOverlap = (a1, a2, b1, b2) => a1 <= b2 && b1 <= a2;
