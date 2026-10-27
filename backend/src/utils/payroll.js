import { round2 } from './salary.js';

/**
 * Illustrative hackathon slabs on ANNUALISED GROSS. Tax is marginal (each rate applies only to the
 * part of income inside its band) which is exactly what the brief's base amounts imply:
 * 30,000 = 5% x 600,000; 210,000 = 30,000 + 15% x 1,200,000; 510,000 = 210,000 + 25% x 1,200,000.
 * Upper bounds are inclusive: 600,000 -> 0; 1,200,000 -> 30,000; 2,400,000 -> 210,000; 3,600,000 -> 510,000.
 */
export const SLABS = [
  { from: 0, upTo: 600000, base: 0, rate: 0 },
  { from: 600000, upTo: 1200000, base: 0, rate: 0.05 },
  { from: 1200000, upTo: 2400000, base: 30000, rate: 0.15 },
  { from: 2400000, upTo: 3600000, base: 210000, rate: 0.25 },
  { from: 3600000, upTo: Infinity, base: 510000, rate: 0.35 },
];

export function annualTax(annualGross) {
  if (!(annualGross > 0)) return 0;
  const s = SLABS.find((x) => annualGross <= x.upTo);
  return round2(s.base + (annualGross - s.from) * s.rate);
}

/**
 * One employee's monthly line.
 *  gross               contractual monthly gross (basic + HRA + medical = 1.5 x basic)
 *  monthWorkingDays    working days in the whole month (weekends/holidays excluded)
 *  windowDates         working dates inside the employee's service window (joiner/leaver proration)
 *  records             Map date -> attendance status
 *  unpaidLeave/anyLeave Sets of approved-leave dates (unpaid types / all types)
 * Rules (no double deductions):
 *  - a day with an attendance record is never absent and never unpaid leave;
 *  - a leave day is never absent; only UNPAID leave is deducted, once;
 *  - today and future days are not absent; missing_checkout counts as present;
 *  - half_day costs 0.5 x daily rate;
 *  - tax is on the contractual gross (annualised), prorated by service days, and is NOT reduced or
 *    increased by attendance deductions.
 */
export function computeLine({ gross, monthWorkingDays, windowDates, records, unpaidLeave, anyLeave, todayKey }) {
  const eligibleDays = windowDates.length;
  const daily = gross / monthWorkingDays;
  let absentDays = 0, unpaidLeaveDays = 0, halfDays = 0;
  for (const d of windowDates) {
    const status = records.get(d);
    if (status) { if (status === 'half_day') halfDays++; continue; }
    if (unpaidLeave.has(d)) { unpaidLeaveDays++; continue; }
    if (anyLeave.has(d)) continue;
    if (d < todayKey) absentDays++;
  }
  const factor = eligibleDays / monthWorkingDays;
  const proratedGross = round2(gross * factor);
  const deductions = { absence: round2(absentDays * daily), unpaidLeave: round2(unpaidLeaveDays * daily), halfDay: round2(halfDays * 0.5 * daily) };
  const annualTaxableGross = round2(gross * 12);
  const tax = round2((annualTax(annualTaxableGross) / 12) * factor);
  const net = Math.max(0, round2(proratedGross - deductions.absence - deductions.unpaidLeave - deductions.halfDay - tax));
  return { eligibleDays, absentDays, unpaidLeaveDays, halfDays, dailyRate: round2(daily), proratedGross, deductions, annualTaxableGross, tax, net };
}
