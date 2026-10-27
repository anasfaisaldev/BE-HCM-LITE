import test from 'node:test';
import assert from 'node:assert/strict';
import { extractJson, leaveParseSchema, summarySchema } from '../src/utils/aiJson.js';

test('model JSON is extracted from fences/prose and validated', () => {
  assert.deepEqual(extractJson('Sure!\n```json\n{"a":1}\n```'), { a: 1 });
  assert.equal(extractJson('no json here'), null); assert.equal(extractJson('{broken'), null);
  assert.equal(leaveParseSchema.safeParse({ leaveTypeCode: 'casual', startDate: '2026-11-02', endDate: '2026-11-03', reason: 'Wedding' }).success, true);
  assert.equal(leaveParseSchema.safeParse({ leaveTypeCode: 'casual', startDate: '2026-11-03', endDate: '2026-11-02' }).success, false);
  assert.equal(leaveParseSchema.safeParse({ leaveTypeCode: 'casual', startDate: '2026-02-31', endDate: '2026-03-01' }).success, false);
  assert.equal(summarySchema.safeParse({ bullets: ['one bullet only'] }).success, false);
  assert.equal(summarySchema.safeParse({ bullets: ['Headcount is 3.', 'Attendance is 90%.', 'Two approvals pending.'] }).success, true);
});
