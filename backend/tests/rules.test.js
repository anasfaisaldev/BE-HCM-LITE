import test from 'node:test';
import assert from 'node:assert/strict';
import { countWorkingDays, localParts, zonedToUtc, rangesOverlap, dayType } from '../src/utils/dates.js';
import { isLate, finalStatus, classifyDay, exceedsQuota, remaining } from '../src/utils/rules.js';

const weekend = [6, 0];
test('late is strictly after 09:15:00 Karachi time', () => {
  const at = (iso) => localParts(new Date(iso), 'Asia/Karachi').secs; // Karachi = UTC+5
  assert.equal(isLate(at('2026-01-05T04:15:00Z'), '09:00', 15), false); // 09:15:00
  assert.equal(isLate(at('2026-01-05T04:15:01Z'), '09:00', 15), true); // 09:15:01
  assert.equal(isLate(at('2026-01-05T03:59:00Z'), '09:00', 15), false);
});
test('half-day is fewer than 5 working hours (exactly 5h is a full day); overrides late', () => {
  assert.equal(finalStatus({ late: false, workedMinutes: 299 }), 'half_day');
  assert.equal(finalStatus({ late: true, workedMinutes: 299 }), 'half_day');
  assert.equal(finalStatus({ late: false, workedMinutes: 300 }), 'present');
  assert.equal(finalStatus({ late: true, workedMinutes: 480 }), 'late');
});
test('working days exclude weekends and public holidays', () => {
  // Mon 2026-01-05 .. Sun 2026-01-11 = 5 working days
  assert.equal(countWorkingDays('2026-01-05', '2026-01-11', weekend, new Set()), 5);
  assert.equal(countWorkingDays('2026-01-05', '2026-01-11', weekend, new Set(['2026-01-07'])), 4);
  assert.equal(countWorkingDays('2026-01-10', '2026-01-11', weekend, new Set()), 0); // Sat+Sun
  assert.equal(countWorkingDays('2026-01-05', '2026-01-05', weekend, new Set()), 1);
});
test('overlap detection is inclusive on both ends', () => {
  assert.ok(rangesOverlap('2026-01-05', '2026-01-07', '2026-01-07', '2026-01-09'));
  assert.equal(rangesOverlap('2026-01-05', '2026-01-06', '2026-01-07', '2026-01-09'), false);
});
test('quota check: exact fit allowed, one over rejected, unlimited never exceeds', () => {
  assert.equal(exceedsQuota(14, 10, 4), false);
  assert.equal(exceedsQuota(14, 10, 5), true);
  assert.equal(exceedsQuota(null, 999, 50), false);
  assert.equal(remaining(8, 3, 2), 3);
  assert.equal(remaining(null, 3, 2), null);
});
test('absent only on past working days with no record and no leave', () => {
  const base = { todayKey: '2026-01-14', joiningKey: '2026-01-01', record: null, onLeave: false, type: 'working' };
  assert.equal(classifyDay({ ...base, dateKey: '2026-01-13' }), 'absent');
  assert.equal(classifyDay({ ...base, dateKey: '2026-01-13', onLeave: true }), 'on_leave');
  assert.equal(classifyDay({ ...base, dateKey: '2026-01-14' }), 'not_checked_in');
  assert.equal(classifyDay({ ...base, dateKey: '2026-01-15' }), 'future');
  assert.equal(classifyDay({ ...base, dateKey: '2026-01-10', type: 'weekend' }), 'weekend');
  assert.equal(classifyDay({ ...base, dateKey: '2025-12-30' }), 'n/a');
  assert.equal(classifyDay({ ...base, dateKey: '2026-01-13', record: { status: 'late' } }), 'late');
});
test('local time zone conversion round-trips', () => {
  assert.equal(zonedToUtc('2026-01-05', '09:15', 'Asia/Karachi').toISOString(), '2026-01-05T04:15:00.000Z');
  assert.equal(dayType('2026-01-04', weekend, new Set()), 'weekend');
});
