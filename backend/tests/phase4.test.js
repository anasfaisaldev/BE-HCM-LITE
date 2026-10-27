import test from 'node:test';
import assert from 'node:assert/strict';
import { absenteeism, attendanceRate, attritionPct, latePct, leaveUtilization, pct } from '../src/utils/metrics.js';
import { isToolAllowed, toolsForRole } from '../src/ai/toolPolicy.js';

test('attendance rate = (present + late + missing_checkout + 0.5 half_day) / (records - on_leave)', () => {
  const t = { present: 10, late: 2, half_day: 2, missing_checkout: 1, absent: 5, on_leave: 7 };
  assert.equal(attendanceRate(t), 70); // (10+2+1+1)=14 / (10+2+2+1+5)=20
  assert.equal(latePct(t), 16.67);     // 2 / 12
  assert.equal(absenteeism(t), 18.52); // 5 / (20 + 7 on leave) = 5/27
});
test('absenteeism denominator is expected working days including leave days', () => {
  assert.equal(absenteeism({ present: 8, absent: 1, on_leave: 1 }), 10);
});
test('empty datasets never divide by zero', () => {
  assert.equal(attendanceRate({}), null); assert.equal(latePct({}), null); assert.equal(absenteeism({ on_leave: 0 }), null);
  assert.equal(attritionPct(0, 0, 0), null); assert.equal(pct(5, 0), null); assert.equal(leaveUtilization(3, null, 10), null);
  assert.equal(leaveUtilization(5, 14, 0), null);
});
test('attrition = leavers / average(start, end headcount); leave utilization = days / (quota x headcount)', () => {
  assert.equal(attritionPct(2, 18, 22), 10);
  assert.equal(leaveUtilization(14, 14, 10), 10);
});
test('AI tool permissions: employees only get own-record tools', () => {
  assert.deepEqual(toolsForRole('employee').sort(), ['get_attendance_summary', 'get_my_leave_balance', 'get_payroll_summary']);
  for (const t of ['search_employees', 'get_late_comers', 'get_leave_summary', 'get_headcount']) assert.equal(isToolAllowed('employee', t), false);
  assert.equal(isToolAllowed('hr', 'search_employees'), true);
  assert.equal(isToolAllowed('nobody', 'get_headcount'), false);
});
