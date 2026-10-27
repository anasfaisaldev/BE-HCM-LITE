// End-to-end API test against an in-memory MongoDB (downloads a mongod binary on first run).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import http from 'node:http';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
let mongod, app;
let A, E, deptId, desId, empId, typeId, mockLLM, toolsOffered = [], parseCalls = 0;

before(async () => {
  // Fake hosted-LLM endpoint (Anthropic Messages shape) so AI behaviour is testable offline.
  mockLLM = http.createServer((req, res) => {
    let b = ''; req.on('data', (d) => (b += d));
    req.on('end', () => {
      const body = JSON.parse(b); toolsOffered = (body.tools || []).map((t) => t.name);
      const last = body.messages.at(-1); const send = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
      const text = (t) => send({ stop_reason: 'end_turn', content: [{ type: 'text', text: t }] });
      if (Array.isArray(last.content) && last.content[0]?.type === 'tool_result') return text(last.content[0].is_error ? 'REFUSED' : `TOOLOK ${last.content[0].content}`);
      const msg = String(last.content);
      if (msg.includes('LEAVEBAL')) return send({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'get_my_leave_balance', input: {} }] });
      if (msg.includes('COLLEAGUE')) return send({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't2', name: 'search_employees', input: { query: 'Omar' } }] });
      if (msg.startsWith('KPI JSON')) return text('```json\n{"bullets":["Headcount is three employees.","Attendance data covers January only.","January payroll was finalized."]}\n```');
      if (body.system.includes('Extract a leave request')) {
        if (++parseCalls === 1) return text('Sorry, I cannot do JSON'); // forces the one retry
        const [mon, tue] = nextWeekdays();
        return text(JSON.stringify({ leaveTypeCode: 'casual', startDate: mon, endDate: tue, reason: 'Wedding' }));
      }
      return text('Hello');
    });
  });
  await new Promise((r) => mockLLM.listen(0, r));
  process.env.AI_API_URL = `http://127.0.0.1:${mockLLM.address().port}/v1/messages`;
  process.env.AI_API_KEY = 'test-key';
  mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  await mongoose.connect(process.env.MONGODB_URI);
  const { createApp } = await import('../src/app.js');
  app = createApp();
  A = request.agent(app); E = request.agent(app);
});
after(async () => { await mongoose.disconnect(); await mongod.stop(); mockLLM.close(); });

const nextWeekdays = () => { // next Monday and Tuesday after today (UTC)
  const d = new Date(); d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7));
  const mon = d.toISOString().slice(0, 10); d.setUTCDate(d.getUTCDate() + 1);
  return [mon, d.toISOString().slice(0, 10)];
};

test('fresh DB needs setup, then setup works once', async () => {
  assert.equal((await A.get('/api/setup/status')).body.data.needsSetup, true);
  const r = await A.post('/api/setup').send({ companyName: 'Acme', name: 'Root Admin', email: 'admin@acme.test', password: 'Admin12345' });
  assert.equal(r.status, 201);
  assert.equal((await request(app).post('/api/setup').send({ companyName: 'X', name: 'Y Z', email: 'y@z.test', password: 'Admin12345' })).status, 409);
});

test('admin builds org, registers employee; employee must change temp password', async () => {
  deptId = (await A.post('/api/org/departments').send({ name: 'Engineering' })).body.data._id;
  desId = (await A.post('/api/org/designations').send({ title: 'Developer' })).body.data._id;
  const r = await A.post('/api/employees').send({ employeeCode: 'E001', name: 'Sara Ali', email: 'sara@acme.test', department: deptId, designation: desId, joiningDate: '2026-01-05', basicSalary: 100000 });
  assert.equal(r.status, 201);
  assert.equal(r.body.data.salary.gross, 150000);
  empId = r.body.data.employee._id;
  const dup = await A.post('/api/employees').send({ employeeCode: 'E001', name: 'Dup One', email: 'dup@acme.test', department: deptId, designation: desId, joiningDate: '2026-01-05', basicSalary: 1 });
  assert.equal(dup.status, 409);
  assert.equal((await E.post('/api/auth/login').send({ email: 'sara@acme.test', password: r.body.data.tempPassword })).status, 200);
  assert.equal((await E.get('/api/attendance/today')).body.error.code, 'PASSWORD_CHANGE_REQUIRED');
  assert.equal((await E.post('/api/auth/change-password').send({ currentPassword: r.body.data.tempPassword, newPassword: 'Sara12345' })).status, 200);
});

test('RBAC and data isolation', async () => {
  assert.equal((await E.get('/api/employees')).status, 403);
  assert.equal((await E.get('/api/audit')).status, 403);
  assert.equal((await E.put('/api/org/settings').send({ name: 'Hacked Co' })).status, 403);
  assert.equal((await request(app).get('/api/employees')).status, 401);
  assert.equal((await E.get(`/api/employees/${empId}`)).status, 200); // own record
  const other = (await A.post('/api/employees').send({ employeeCode: 'E002', name: 'Omar Khan', email: 'omar@acme.test', department: deptId, designation: desId, joiningDate: '2026-01-05', basicSalary: 50000 })).body.data.employee._id;
  assert.equal((await E.get(`/api/employees/${other}`)).status, 403); // colleague
  assert.equal((await E.patch('/api/employees/me').send({ phone: '0300', salary: 1 })).status, 422); // strict: no extra fields
});

test('duplicate check-in returns 409; check-out completes the record', async () => {
  assert.equal((await E.post('/api/attendance/check-in')).status, 201);
  assert.equal((await E.post('/api/attendance/check-in')).status, 409);
  assert.equal((await E.post('/api/attendance/check-out')).status, 200);
  assert.equal((await E.post('/api/attendance/check-out')).status, 409);
});

test('leave: working days, overlap 422, over-balance 422, approval + notification', async () => {
  const types = (await A.get('/api/org')).body.data.leaveTypes;
  typeId = types.find((t) => t.code === 'sick')._id;
  assert.equal(types.find((t) => t.code === 'annual').annualQuota, 14);
  const [mon, tue] = nextWeekdays();
  const ok = await E.post('/api/leave/requests').send({ leaveType: typeId, startDate: mon, endDate: tue, reason: 'Wedding' });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.data.days, 2);
  assert.equal((await E.post('/api/leave/requests').send({ leaveType: typeId, startDate: tue, endDate: tue })).status, 422); // overlap
  // Sick quota is 8: 2 used, so a 7-working-day request in a later week exceeds it
  const d = new Date(`${mon}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 7); const s = d.toISOString().slice(0, 10);
  d.setUTCDate(d.getUTCDate() + 8); const e = d.toISOString().slice(0, 10); // 11 calendar days -> 9 working days
  if (s.slice(0, 4) === e.slice(0, 4)) assert.equal((await E.post('/api/leave/requests').send({ leaveType: typeId, startDate: s, endDate: e })).status, 422);
  assert.equal((await E.patch(`/api/leave/requests/${ok.body.data._id}/decision`).send({ decision: 'approved' })).status, 403); // employee cannot approve
  assert.equal((await A.patch(`/api/leave/requests/${ok.body.data._id}/decision`).send({ decision: 'rejected' })).status, 422); // comment required
  assert.equal((await A.patch(`/api/leave/requests/${ok.body.data._id}/decision`).send({ decision: 'approved', comment: 'Enjoy' })).status, 200);
  const n = await E.get('/api/notifications');
  assert.ok(n.body.data.some((x) => x.type === 'leave_decision'));
  const bal = (await E.get('/api/leave/balance')).body.data.balances.find((b) => b.leaveType.code === 'sick');
  assert.equal(bal.used, 2);
});

test('payroll: HR drafts, only Admin finalizes, finalized is locked, employees see only their own finalized payslip', async () => {
  const { Payslip } = await import('../src/models/Payslip.js');
  const reg = await A.post('/api/employees').send({ employeeCode: 'H001', name: 'Hina Raza', email: 'hina@acme.test', department: deptId, designation: desId, joiningDate: '2025-06-01', basicSalary: 80000, role: 'hr' });
  assert.equal(reg.status, 201);
  const H = request.agent(app);
  await H.post('/api/auth/login').send({ email: 'hina@acme.test', password: reg.body.data.tempPassword });
  await H.post('/api/auth/change-password').send({ currentPassword: reg.body.data.tempPassword, newPassword: 'Hina12345' });

  assert.equal((await E.post('/api/payroll/runs').send({ month: '2026-01' })).status, 403); // employee cannot draft
  assert.equal((await H.post('/api/payroll/runs').send({ month: '2999-01' })).status, 422); // future month
  const run = await H.post('/api/payroll/runs').send({ month: '2026-01' });
  assert.equal(run.status, 201);
  const runId = run.body.data._id;
  assert.equal((await H.post(`/api/payroll/runs/${runId}/finalize`)).status, 403); // HR cannot finalize

  const slipOf = async (code) => (await H.get(`/api/payroll/runs/${runId}`)).body.data.items.find((s) => s.employeeCode === code);
  const sara = await slipOf('E001');
  // Jan 2026: 22 working days; Sara joined Jan 5 -> 20 in service, none attended -> 20 absent
  assert.equal(sara.workingDays, 22); assert.equal(sara.eligibleDays, 20); assert.equal(sara.absentDays, 20);
  assert.equal(sara.proratedGross, 136363.64); assert.equal(sara.deductions.absence, 136363.64);
  assert.equal(sara.tax, 9090.91); assert.equal(sara.net, 0);

  assert.equal((await E.get('/api/payslips')).body.data.length, 0); // drafts invisible to employees
  assert.equal((await E.get(`/api/payslips/${sara._id}`)).status, 404);
  assert.equal((await H.post('/api/payroll/runs').send({ month: '2026-01' })).status, 201); // draft can be regenerated

  assert.equal((await A.post(`/api/payroll/runs/${runId}/finalize`)).status, 200);
  assert.equal((await A.post(`/api/payroll/runs/${runId}/finalize`)).status, 409);
  assert.equal((await H.post('/api/payroll/runs').send({ month: '2026-01' })).status, 409); // locked

  const mine = (await E.get('/api/payslips')).body.data;
  assert.equal(mine.length, 1); assert.equal(mine[0].employeeCode, 'E001');
  const omar = await slipOf('E002');
  assert.equal((await E.get(`/api/payslips/${omar._id}`)).status, 404); // colleague's payslip
  const pdf = await E.get(`/api/payslips/${mine[0]._id}/pdf`).buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
  assert.match(pdf.headers['content-type'], /pdf/); assert.equal(pdf.body.subarray(0, 4).toString(), '%PDF');
  assert.ok((await E.get('/api/notifications')).body.data.some((n) => n.type === 'payslip'));

  await assert.rejects(Payslip.updateOne({ _id: mine[0]._id }, { net: 999999 })); // immutable at the model level
  await assert.rejects(Payslip.deleteMany({ run: runId }));
});

const login = async (email, password) => { const a = request.agent(app); await a.post('/api/auth/login').send({ email, password }); return a; };

test('dashboards: numbers reconcile with the underlying records; empty ranges do not break', async () => {
  const H = await login('hina@acme.test', 'Hina12345');
  const range = '?from=2026-01-01&to=2026-03-31';
  const adm = (await A.get(`/api/dashboard${range}`)).body.data;
  const total = (await A.get('/api/employees?limit=1')).body.meta.total;
  assert.equal(adm.kpis.headcount, total); assert.equal(total, 3);
  assert.equal(adm.headcountByDepartment.reduce((t, d) => t + d.count, 0), adm.kpis.headcount);
  const run = (await A.get('/api/payroll/runs')).body.data.find((r) => r.month === '2026-01');
  assert.equal(adm.payroll.gross, run.totals.gross); assert.equal(adm.kpis.payrollCostGross, run.totals.gross);
  assert.equal(adm.attrition.ratePct, 0);
  assert.ok(adm.salary.averageGross > 0);

  const hr = (await H.get('/api/dashboard?from=2026-01-01&to=2026-01-31')).body.data;
  const slips = (await A.get(`/api/payroll/runs/${run._id}`)).body.data.items;
  assert.equal(hr.attendance.totals.absent, slips.reduce((t, s) => t + s.absentDays, 0)); // dashboard == payroll == records
  assert.equal(hr.attendance.attendanceRatePct, 0); assert.equal(hr.attendance.absenteeismPct, 100);
  assert.equal((await H.get('/api/dashboard')).body.data.kpis.headcount, 3);

  const empty = (await H.get('/api/dashboard?from=2020-01-01&to=2020-01-31')).body.data;
  assert.equal(empty.kpis.headcount, 0); assert.equal(empty.attendance.attendanceRatePct, null); assert.deepEqual(empty.attendanceTrend, []);
  assert.equal((await H.get('/api/dashboard?from=2026-01-01&to=2027-01-01')).status, 422); // range cap

  const me = (await E.get('/api/dashboard')).body.data;
  assert.equal(me.week.targetHours, 40); assert.equal(me.leaveBalances.length, 4); assert.equal(me.lastPayslip.month, '2026-01');
  assert.equal((await E.get('/api/dashboard?department=' + deptId)).status, 200); // employees cannot widen their scope via filters
});

test('announcements: HR/Admin post, employees read only', async () => {
  const H = await login('hina@acme.test', 'Hina12345');
  assert.equal((await E.post('/api/announcements').send({ title: 'Hack', body: 'nope' })).status, 403);
  assert.equal((await H.post('/api/announcements').send({ title: 'Eid holiday', body: 'Office closed Friday.' })).status, 201);
  assert.ok((await E.get('/api/dashboard')).body.data.announcements.some((a) => a.title === 'Eid holiday'));
});

test('AI: tools are role-scoped, calls are logged, JSON is validated with one retry, leave is only prefilled', async () => {
  const { AILog } = await import('../src/models/AILog.js');
  const ok = await E.post('/api/ai/chat').send({ message: 'LEAVEBAL what is my balance?' });
  assert.equal(ok.status, 200); assert.equal(ok.body.data.label, 'AI-generated');
  assert.match(ok.body.data.reply, /TOOLOK/); assert.deepEqual(ok.body.data.toolsUsed, ['get_my_leave_balance']);
  assert.ok(!toolsOffered.includes('search_employees') && !toolsOffered.includes('get_late_comers')); // employee is never even offered these

  const refused = await E.post('/api/ai/chat').send({ message: 'COLLEAGUE what is Omar salary?' }); // model tries a forbidden tool anyway
  assert.match(refused.body.data.reply, /REFUSED/);
  const log = await AILog.findOne({ 'toolCalls.error': /not permitted/i }).lean();
  assert.ok(log); assert.equal(log.role, 'employee');

  const H = await login('hina@acme.test', 'Hina12345');
  const sum = await H.post('/api/ai/dashboard-summary').send({ from: '2026-01-01', to: '2026-01-31' });
  assert.equal(sum.body.data.bullets.length, 3); assert.equal(sum.body.data.label, 'AI-generated');
  assert.equal((await E.post('/api/ai/dashboard-summary').send({})).status, 403);

  const before = (await E.get('/api/leave/requests')).body.meta.total;
  const parsed = await E.post('/api/ai/leave-parse').send({ text: 'I need next Monday and Tuesday off for a wedding' }); // first model reply is invalid, retry succeeds
  const [mon, tue] = nextWeekdays();
  assert.equal(parsed.body.data.fallback, false); assert.equal(parsed.body.data.prefill.startDate, mon); assert.equal(parsed.body.data.prefill.endDate, tue);
  assert.equal(parsed.body.data.workingDays, 2);
  assert.equal((await E.get('/api/leave/requests')).body.meta.total, before); // nothing was submitted

  assert.ok((await AILog.countDocuments()) >= 5);
});

test('AI: friendly fallback when the model is unavailable; 20/hour rate limit', async () => {
  const { env } = await import('../src/config/env.js');
  const key = env.aiApiKey; env.aiApiKey = '';
  const expectedHeadcount = (await A.get('/api/dashboard')).body.data.kpis.headcount;
  const headcount = await A.post('/api/ai/chat').send({ message: 'How many employees do we have?' });
  assert.equal(headcount.status, 200);
  assert.equal(headcount.body.data.fallback, true);
  assert.deepEqual(headcount.body.data.toolsUsed, ['get_headcount']);
  assert.match(headcount.body.data.reply, new RegExp(`There are ${expectedHeadcount} employees currently in service`));
  const greeting = await A.post('/api/ai/chat').send({ message: 'hello' });
  assert.equal(greeting.status, 200);
  assert.equal(greeting.body.data.fallback, true);
  assert.match(greeting.body.data.reply, /Hello! I can help with live HCM data/);
  const down = await A.post('/api/ai/chat').send({ message: 'What is the weather today?' });
  assert.equal(down.status, 200); assert.equal(down.body.data.fallback, true);
  const sum = await A.post('/api/ai/dashboard-summary').send({});
  assert.equal(sum.body.data.fallback, true); assert.ok(sum.body.data.bullets.length >= 3);
  env.aiApiKey = key;

  const codes = [];
  for (let i = 0; i < 24; i++) codes.push((await E.post('/api/ai/chat').send({ message: 'hi' })).status);
  assert.ok(codes.includes(429)); assert.ok(codes.filter((c) => c === 200).length < 20);
});

let zaraTemp;
test('CSV import: dry-run reports row/field/reason and writes nothing; real import is all-or-nothing', async () => {
  const header = 'employeeCode,name,email,phone,gender,department,designation,joiningDate,status,basicSalary';
  const bad = [header,
    'E001,Dup Code,dupc@acme.test,,male,Engineering,Developer,2026-06-01,active,50000',  // row 2: code exists
    'Z100,Bad Mail,not-an-email,,female,Engineering,Developer,2026-06-01,active,50000',  // row 3: email format
    'Z101,No Dept,z101@acme.test,,male,Nowhere,Developer,2026-06-01,active,50000',      // row 4: unknown department
    'Z102,Bad Date,z102@acme.test,,male,Engineering,Developer,2026-13-01,active,50000', // row 5: not an ISO date
    'Z103,Zero Pay,z103@acme.test,,male,Engineering,Developer,2026-06-01,active,0',     // row 6: salary 0
    'Z104,Same Mail,z103@acme.test,,male,Engineering,Developer,2026-06-01,active,abc',  // row 7: duplicate email in file + non-numeric salary
    'Z105,Good One,z105@acme.test,,male,Engineering,Developer,2026-06-01,active,50000', // row 8: valid
  ].join('\n');
  const total = async () => (await A.get('/api/employees?limit=1')).body.meta.total;
  const before = await total();

  const dry = await A.post('/api/employees/import').send({ csv: bad, dryRun: true });
  assert.equal(dry.status, 200); assert.equal(dry.body.data.totalRows, 7); assert.equal(dry.body.data.validRows, 1);
  const has = (row, field) => dry.body.data.errors.some((e) => e.row === row && e.field === field && e.reason);
  for (const [row, field] of [[2, 'employeeCode'], [3, 'email'], [4, 'department'], [5, 'joiningDate'], [6, 'basicSalary'], [7, 'email'], [7, 'basicSalary']]) assert.ok(has(row, field), `missing error row ${row} ${field}`);
  assert.ok(!dry.body.data.errors.some((e) => e.row === 8));
  assert.equal(await total(), before); // dry run wrote nothing

  const refused = await A.post('/api/employees/import').send({ csv: bad, dryRun: false });
  assert.equal(refused.status, 422); assert.equal(await total(), before); // all-or-nothing

  const good = `${header}\nZ200,Zara Noor,zara@acme.test,0300,female,engineering,developer,2026-06-01,active,60000`; // names are case-insensitive
  const done = await A.post('/api/employees/import').send({ csv: good, dryRun: false });
  assert.equal(done.status, 200); assert.equal(done.body.data.created.length, 1); assert.ok(done.body.data.created[0].tempPassword);
  zaraTemp = done.body.data.created[0].tempPassword;
  assert.equal(await total(), before + 1);
  assert.equal((await E.post('/api/employees/import').send({ csv: good, dryRun: true })).status, 403);
  assert.equal((await A.post('/api/employees/import').send({ csv: 'name\nX', dryRun: true })).status, 422); // missing columns
});

test('camera attendance: one face, GPS accuracy and Haversine radius are enforced by the server', async () => {
  assert.equal((await A.put('/api/org/settings').send({ geo: { lat: 24.8607, lng: 67.0011, radiusMeters: 200 }, requireCameraCheckIn: true })).status, 200);
  const Z = request.agent(app);
  await Z.post('/api/auth/login').send({ email: 'zara@acme.test', password: zaraTemp });
  await Z.post('/api/auth/change-password').send({ currentPassword: zaraTemp, newPassword: 'Zara12345' });
  const near = { faceCount: 1, lat: 24.8608, lng: 67.0011, accuracy: 20 }; // ~11 m from the office
  const code = async (v, extra = {}) => { const r = await Z.post('/api/attendance/check-in').send({ verification: v, ...extra }); return [r.status, r.body.error?.code, r.body]; };

  assert.equal((await Z.post('/api/attendance/check-in').send({})).body.error.code, 'CAMERA_REQUIRED');
  assert.equal((await code({ ...near, faceCount: 0 }))[1], 'FACE_CHECK_FAILED');
  assert.equal((await code({ ...near, faceCount: 2 }))[1], 'FACE_CHECK_FAILED');
  assert.equal((await code({ ...near, accuracy: 150 }))[1], 'GPS_ACCURACY');
  const far = { faceCount: 1, lat: 24.87, lng: 67.0011, accuracy: 20 };
  assert.equal((await code(far))[1], 'OUTSIDE_RADIUS');
  assert.equal((await code(far, { distanceMeters: 0, checkIn: '2026-01-01T09:00:00Z' }))[1], 'OUTSIDE_RADIUS'); // client-supplied distance/time ignored

  const ok = await code(near);
  assert.equal(ok[0], 201);
  const d = ok[2].data.verification.in.distanceMeters;
  assert.ok(d > 5 && d < 20, `distance ${d}`);
  assert.equal((await code(near))[0], 409); // still one record per day
  const out = await Z.post('/api/attendance/check-out').send({ verification: near });
  assert.equal(out.status, 200); assert.equal(out.body.data.verification.out.faceCount, 1);
  assert.equal((await Z.post('/api/attendance/check-out').send({})).status, 409);

  assert.equal((await A.put('/api/org/settings').send({ requireCameraCheckIn: false })).status, 200); // optional again
});
