import test from 'node:test';
import assert from 'node:assert/strict';
import { annualTax, computeLine } from '../src/utils/payroll.js';

test('tax slab boundaries (inclusive upper bounds, marginal rates)', () => {
  assert.equal(annualTax(0), 0);
  assert.equal(annualTax(600000), 0);
  assert.equal(annualTax(600001), 0.05);
  assert.equal(annualTax(1200000), 30000);
  assert.equal(annualTax(1200001), 30000.15);
  assert.equal(annualTax(2400000), 210000);
  assert.equal(annualTax(3600000), 510000);
  assert.equal(annualTax(4000000), 650000);
  assert.equal(annualTax(-5), 0);
});

const dates = (n) => Array.from({ length: n }, (_, i) => `2026-01-${String(i + 1).padStart(2, '0')}`);
const base = { gross: 66000, monthWorkingDays: 22, records: new Map(), unpaidLeave: new Set(), anyLeave: new Set(), todayKey: '2026-02-15' };

test('perfect attendance, below tax threshold: net equals gross', () => {
  const recs = new Map(dates(22).map((d) => [d, 'present']));
  const r = computeLine({ ...base, gross: 40000, windowDates: dates(22), records: recs });
  assert.equal(r.tax, 0); assert.equal(r.net, 40000); assert.equal(r.absentDays, 0);
});

test('daily rate = gross / working days; absence, unpaid leave and half-day deductions', () => {
  const w = dates(22);
  const recs = new Map(w.slice(0, 18).map((d) => [d, 'present']));
  recs.set(w[18], 'half_day');           // 1 half day
  const r = computeLine({ ...base, windowDates: w, records: recs, unpaidLeave: new Set([w[19]]), anyLeave: new Set([w[19], w[20]]) }); // w[21] absent, w[20] paid leave
  assert.equal(r.dailyRate, 3000);
  assert.equal(r.absentDays, 1); assert.equal(r.unpaidLeaveDays, 1); assert.equal(r.halfDays, 1);
  assert.deepEqual(r.deductions, { absence: 3000, unpaidLeave: 3000, halfDay: 1500 });
  assert.equal(r.tax, 800); // 792,000/yr: 5% of 192,000 = 9,600/yr = 800/month
  assert.equal(r.net, 66000 - 7500 - 800);
});

test('no double deduction: leave day with an attendance record, and paid leave, are never absent', () => {
  const w = dates(3);
  const r = computeLine({ ...base, windowDates: w, monthWorkingDays: 3, gross: 3000, records: new Map([[w[0], 'present']]), unpaidLeave: new Set([w[0], w[1]]), anyLeave: new Set([w[0], w[1], w[2]]) });
  assert.equal(r.absentDays, 0);
  assert.equal(r.unpaidLeaveDays, 1); // w[0] has a record so it is not unpaid; w[1] is
});

test('joiner proration: half the month in service pays half gross and half tax', () => {
  const gross = 300000; // annual 3.6M -> tax 510,000/yr
  const full = computeLine({ ...base, gross, windowDates: dates(22), records: new Map(dates(22).map((d) => [d, 'present'])) });
  const half = computeLine({ ...base, gross, windowDates: dates(11), records: new Map(dates(11).map((d) => [d, 'present'])) });
  assert.equal(full.tax, 42500);
  assert.equal(half.proratedGross, 150000); assert.equal(half.tax, 21250); assert.equal(half.net, 128750);
});

test('today and future days are not counted absent; net never negative', () => {
  const r = computeLine({ ...base, windowDates: ['2026-02-15', '2026-02-16'], monthWorkingDays: 20, todayKey: '2026-02-15' });
  assert.equal(r.absentDays, 0);
  const z = computeLine({ ...base, gross: 1000000, windowDates: dates(22), monthWorkingDays: 22 }); // all absent, big tax
  assert.equal(z.net, 0);
});
