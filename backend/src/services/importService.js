import { Department } from '../models/Department.js';
import { Designation } from '../models/Designation.js';
import { Employee } from '../models/Employee.js';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { parseCsvRecords } from '../utils/csvParse.js';
import { employeeCreateSchema } from '../validators/index.js';
import { createEmployee } from './employeeService.js';
import { recordAudit } from './auditService.js';

export const IMPORT_COLUMNS = ['employeeCode', 'name', 'email', 'phone', 'gender', 'department', 'designation', 'joiningDate', 'status', 'basicSalary'];
const REQUIRED = ['employeeCode', 'name', 'email', 'department', 'designation', 'joiningDate', 'basicSalary'];
const MAX_ROWS = 200;
const PLACEHOLDER_ID = '0'.repeat(24);

/** Validates every row and reports { row, field, reason } for every problem. Writes nothing. */
export async function validateImport(csv) {
  let records;
  try { records = parseCsvRecords(csv); } catch (e) { throw new ApiError(422, `Cannot read the file: ${e.message}`); }
  if (records.length === 0) throw new ApiError(422, 'The file is empty');
  const header = records[0].cells.map((h) => h.trim());
  const headerErrors = REQUIRED.filter((c) => !header.includes(c)).map((c) => ({ row: 1, field: c, reason: 'Required column is missing' }));
  if (headerErrors.length) throw new ApiError(422, 'The header row is missing required columns', headerErrors);
  const data = records.slice(1);
  if (data.length === 0) throw new ApiError(422, 'The file has a header but no data rows');
  if (data.length > MAX_ROWS) throw new ApiError(422, `Import at most ${MAX_ROWS} rows at a time (this file has ${data.length})`);

  const [deps, dess, emps, users] = await Promise.all([Department.find().lean(), Designation.find().lean(), Employee.find().select('employeeCode email').lean(), User.find().select('email').lean()]);
  const depBy = new Map(deps.map((d) => [d.name.toLowerCase(), String(d._id)]));
  const desBy = new Map(dess.map((d) => [d.title.toLowerCase(), String(d._id)]));
  const codes = new Set(emps.map((e) => e.employeeCode));
  const emails = new Set([...emps.map((e) => e.email), ...users.map((u) => u.email)]);
  const seenCode = new Map(), seenEmail = new Map();

  const errors = [], rows = [];
  for (const rec of data) {
    const row = rec.line;
    const bad = new Set();
    const add = (field, reason) => { errors.push({ row, field, reason }); bad.add(field); };
    if (rec.cells.length > header.length) add('(row)', `Has ${rec.cells.length} values but the header has ${header.length} columns`);
    const v = {};
    header.forEach((h, i) => { const x = (rec.cells[i] ?? '').trim(); if (IMPORT_COLUMNS.includes(h)) v[h] = x === '' ? undefined : x; });
    for (const c of REQUIRED) if (v[c] === undefined) add(c, 'Required');

    const depId = v.department ? depBy.get(v.department.toLowerCase()) : undefined;
    if (v.department && !depId) add('department', `Unknown department "${v.department}"`);
    const desId = v.designation ? desBy.get(v.designation.toLowerCase()) : undefined;
    if (v.designation && !desId) add('designation', `Unknown designation "${v.designation}"`);
    let salary;
    if (v.basicSalary !== undefined) { salary = Number(v.basicSalary); if (!Number.isFinite(salary)) { add('basicSalary', 'Must be a number'); salary = undefined; } }

    const parsed = employeeCreateSchema.safeParse({
      employeeCode: v.employeeCode, name: v.name, email: v.email, phone: v.phone, gender: v.gender?.toLowerCase(),
      department: depId || PLACEHOLDER_ID, designation: desId || PLACEHOLDER_ID, joiningDate: v.joiningDate,
      status: v.status?.toLowerCase() || 'active', basicSalary: salary ?? 1, role: 'employee',
    });
    if (!parsed.success) for (const i of parsed.error.issues) { const f = String(i.path[0]); if (!bad.has(f) && v[f] !== undefined) add(f, i.message); }

    if (v.employeeCode && !bad.has('employeeCode')) {
      const code = v.employeeCode.toUpperCase();
      if (codes.has(code)) add('employeeCode', 'Already exists in the system');
      else if (seenCode.has(code)) add('employeeCode', `Duplicate of row ${seenCode.get(code)} in this file`);
      else seenCode.set(code, row);
    }
    if (v.email && !bad.has('email')) {
      const em = v.email.toLowerCase();
      if (emails.has(em)) add('email', 'Already exists in the system');
      else if (seenEmail.has(em)) add('email', `Duplicate of row ${seenEmail.get(em)} in this file`);
      else seenEmail.set(em, row);
    }
    rows.push({ row, ok: bad.size === 0, input: bad.size === 0 ? { ...parsed.data, role: 'employee' } : null });
  }
  return { totalRows: data.length, validRows: rows.filter((r) => r.ok).length, errors, rows };
}

export async function importEmployees(actor, { csv, dryRun }) {
  const v = await validateImport(csv);
  if (dryRun) return { dryRun: true, totalRows: v.totalRows, validRows: v.validRows, errors: v.errors };
  if (v.errors.length) throw new ApiError(422, `The file has ${v.errors.length} problem(s). Nothing was imported. Run a dry-run, fix them and try again.`, v.errors);
  const created = [], failed = [];
  for (const r of v.rows) {
    try {
      const res = await createEmployee(actor, r.input);
      created.push({ row: r.row, employeeCode: res.employee.employeeCode, name: res.employee.name, email: res.employee.email, tempPassword: res.tempPassword });
    } catch (e) { failed.push({ row: r.row, reason: e.message }); } // e.g. a duplicate created by someone else mid-import
  }
  await recordAudit(actor, 'employee.imported', 'Employee', undefined, null, { created: created.length, failed: failed.length });
  return { dryRun: false, created, failed };
}
