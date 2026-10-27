import test from 'node:test';
import assert from 'node:assert/strict';

process.env.MONGODB_URI = 'mongodb://localhost/test';
process.env.JWT_SECRET = 'test-secret';

const { salaryFromBasic } = await import('../src/utils/salary.js');
const { hashPassword, verifyPassword, generateTempPassword } = await import('../src/utils/password.js');
const { authorize } = await import('../src/middleware/auth.js');
const { passwordRule, employeeCreateSchema } = await import('../src/validators/index.js');
const { csvCell } = await import('../src/utils/csv.js');

test('gross = 1.5 x basic, built from basic + 40% HRA + 10% medical', () => {
  assert.deepEqual(salaryFromBasic(100000), { basic: 100000, hra: 40000, medical: 10000, gross: 150000 });
});

test('passwords are hashed with bcrypt, never stored plain, and verify', async () => {
  const hash = await hashPassword('Secret123');
  assert.notEqual(hash, 'Secret123');
  assert.match(hash, /^\$2[aby]\$12\$/);
  assert.ok(await verifyPassword('Secret123', hash));
  assert.equal(await verifyPassword('wrong', hash), false);
});

test('temp passwords satisfy the password policy', () => {
  for (let i = 0; i < 20; i++) assert.ok(passwordRule.safeParse(generateTempPassword()).success);
});

test('RBAC: authorize blocks wrong roles with 403', () => {
  const run = (role) => { let err; authorize('admin', 'hr')({ user: { role } }, {}, (e) => (err = e)); return err; };
  assert.equal(run('employee').status, 403);
  assert.equal(run('hr'), undefined);
  assert.equal(run('admin'), undefined);
});

test('employee validation: salary must be > 0 and dates must be ISO', () => {
  const base = { employeeCode: 'E1', name: 'Ali Khan', email: 'ali@x.com', department: 'a'.repeat(24), designation: 'b'.repeat(24), joiningDate: '2026-01-05', basicSalary: 1000 };
  assert.ok(employeeCreateSchema.safeParse(base).success);
  assert.equal(employeeCreateSchema.safeParse({ ...base, basicSalary: 0 }).success, false);
  assert.equal(employeeCreateSchema.safeParse({ ...base, joiningDate: '2026-02-31' }).success, false);
});

test('CSV cells neutralise formula injection', () => {
  assert.equal(csvCell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(csvCell('a,b'), '"a,b"');
});
