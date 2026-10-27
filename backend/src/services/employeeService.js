import { Employee } from '../models/Employee.js';
import { User } from '../models/User.js';
import { Department } from '../models/Department.js';
import { Designation } from '../models/Designation.js';
import { SalaryStructure } from '../models/SalaryStructure.js';
import { ApiError } from '../utils/ApiError.js';
import { generateTempPassword, hashPassword } from '../utils/password.js';
import { salaryFromBasic } from '../utils/salary.js';
import { toCsv } from '../utils/csv.js';
import { recordAudit } from './auditService.js';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function buildFilter(q) {
  const f = {};
  if (q.search) {
    const r = new RegExp(esc(q.search), 'i');
    f.$or = [{ name: r }, { email: r }, { employeeCode: r }];
  }
  for (const k of ['department', 'designation', 'status']) if (q[k]) f[k] = q[k];
  return f;
}

async function withSalary(employees) {
  if (!employees.length) return employees;
  const rows = await SalaryStructure.aggregate([
    { $match: { employee: { $in: employees.map((e) => e._id) } } },
    { $sort: { effectiveFrom: -1, createdAt: -1 } },
    { $group: { _id: '$employee', basic: { $first: '$basic' }, gross: { $first: '$gross' } } },
  ]);
  const map = new Map(rows.map((r) => [String(r._id), r]));
  return employees.map((e) => ({ ...e, salary: map.get(String(e._id)) || null }));
}

const populate = (q) => q.populate('department', 'name').populate('designation', 'title').populate('user', 'role isActive mustChangePassword');

export async function listEmployees(q) {
  const filter = buildFilter(q);
  const [items, total] = await Promise.all([
    populate(Employee.find(filter).sort({ name: 1 }).skip((q.page - 1) * q.limit).limit(q.limit)).lean(),
    Employee.countDocuments(filter),
  ]);
  return { items: await withSalary(items), meta: { page: q.page, limit: q.limit, total, pages: Math.ceil(total / q.limit) } };
}

/** Record-level scope: Employees only ever see their own record; HR cannot touch Admin accounts. */
function assertCanAccess(actor, employee) {
  const ownerId = String(employee.user?._id || employee.user);
  if (actor.role === 'employee' && ownerId !== String(actor._id)) throw new ApiError(403, 'You can only view your own record');
  if (actor.role === 'hr' && employee.user?.role === 'admin') throw new ApiError(403, 'HR cannot access Admin accounts');
}

export async function getEmployee(actor, id) {
  const employee = await populate(Employee.findById(id)).lean();
  if (!employee) throw new ApiError(404, 'Employee not found');
  assertCanAccess(actor, employee);
  const history = await SalaryStructure.find({ employee: employee._id }).sort({ effectiveFrom: -1, createdAt: -1 }).lean();
  return { ...employee, salary: history[0] || null, salaryHistory: history };
}

export async function getOwnEmployee(actor) {
  const own = await Employee.findOne({ user: actor._id }).select('_id').lean();
  if (!own) throw new ApiError(404, 'No employee profile is linked to this account');
  return getEmployee(actor, own._id);
}

export async function createEmployee(actor, input) {
  if (input.role !== 'employee' && actor.role !== 'admin') throw new ApiError(403, 'Only Admin can create HR or Admin accounts');
  const email = input.email.toLowerCase();
  const code = input.employeeCode.toUpperCase();
  const [dupEmp, dupUser] = await Promise.all([
    Employee.findOne({ $or: [{ employeeCode: code }, { email }] }).lean(),
    User.findOne({ email }).lean(),
  ]);
  if (dupEmp || dupUser) throw new ApiError(409, 'Employee code or email already exists', [
    ...(dupEmp?.employeeCode === code ? [{ field: 'employeeCode', reason: 'Already in use' }] : []),
    ...(dupEmp?.email === email || dupUser ? [{ field: 'email', reason: 'Already in use' }] : []),
  ]);
  const [dep, des] = await Promise.all([Department.exists({ _id: input.department }), Designation.exists({ _id: input.designation })]);
  if (!dep) throw new ApiError(422, 'Unknown department', [{ field: 'department', reason: 'Not found' }]);
  if (!des) throw new ApiError(422, 'Unknown designation', [{ field: 'designation', reason: 'Not found' }]);

  const tempPassword = generateTempPassword();
  const user = await User.create({ name: input.name, email, role: input.role, passwordHash: await hashPassword(tempPassword), mustChangePassword: true });
  try {
    const employee = await Employee.create({
      user: user._id, employeeCode: code, name: input.name, email, phone: input.phone, gender: input.gender,
      department: input.department, designation: input.designation, joiningDate: new Date(input.joiningDate), status: input.status,
    });
    const salary = await SalaryStructure.create({
      employee: employee._id, ...salaryFromBasic(input.basicSalary), effectiveFrom: new Date(input.joiningDate), createdBy: actor._id,
    });
    await recordAudit(actor, 'employee.created', 'Employee', employee._id, null, { ...employee.toObject(), salary: salary.toObject(), role: input.role });
    return { employee, salary, tempPassword }; // tempPassword is shown once, never stored in plain text
  } catch (e) {
    await User.deleteOne({ _id: user._id });
    await Employee.deleteOne({ user: user._id });
    throw e;
  }
}

export async function updateEmployee(actor, id, patch) {
  const employee = await Employee.findById(id).populate('user', 'role isActive');
  if (!employee) throw new ApiError(404, 'Employee not found');
  assertCanAccess(actor, employee);
  const before = employee.toObject();
  const { basicSalary, leavingDate, ...fields } = patch;
  if (fields.department && !(await Department.exists({ _id: fields.department }))) throw new ApiError(422, 'Unknown department');
  if (fields.designation && !(await Designation.exists({ _id: fields.designation }))) throw new ApiError(422, 'Unknown designation');
  employee.set(fields);
  if (fields.name) await User.updateOne({ _id: employee.user._id }, { name: fields.name });
  if (fields.status) {
    const left = ['resigned', 'terminated'].includes(fields.status);
    employee.leavingDate = left ? new Date(leavingDate || Date.now()) : undefined;
    await User.updateOne({ _id: employee.user._id }, { isActive: !left }); // leavers can no longer sign in
  } else if (leavingDate) employee.leavingDate = new Date(leavingDate);
  await employee.save();
  let salary;
  if (basicSalary) {
    salary = await SalaryStructure.create({ employee: employee._id, ...salaryFromBasic(basicSalary), effectiveFrom: new Date(), createdBy: actor._id });
  }
  await recordAudit(actor, 'employee.updated', 'Employee', employee._id, before, { ...employee.toObject(), ...(salary ? { salary: salary.toObject() } : {}) });
  return getEmployee(actor, id);
}

/** Employees may change only phone and address on their own record. */
export async function updateOwnContact(actor, patch) {
  const employee = await Employee.findOne({ user: actor._id });
  if (!employee) throw new ApiError(404, 'No employee profile is linked to this account');
  const before = { phone: employee.phone, address: employee.address };
  employee.set(patch);
  await employee.save();
  await recordAudit(actor, 'employee.contact_updated', 'Employee', employee._id, before, { phone: employee.phone, address: employee.address });
  return getEmployee(actor, employee._id);
}

export async function exportEmployeesCsv(actor, q) {
  const items = await withSalary(await populate(Employee.find(buildFilter(q)).sort({ employeeCode: 1 })).lean());
  const rows = [['Employee Code', 'Name', 'Email', 'Phone', 'Department', 'Designation', 'Joining Date', 'Status', 'Basic', 'Gross']];
  for (const e of items) {
    if (actor.role === 'hr' && e.user?.role === 'admin') continue;
    rows.push([e.employeeCode, e.name, e.email, e.phone, e.department?.name, e.designation?.title, e.joiningDate?.toISOString().slice(0, 10), e.status, e.salary?.basic, e.salary?.gross]);
  }
  await recordAudit(actor, 'employee.exported', 'Employee', undefined, null, { rows: rows.length - 1 });
  return toCsv(rows);
}
