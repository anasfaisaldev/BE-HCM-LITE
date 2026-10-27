import { Attendance } from '../models/Attendance.js';
import { Employee } from '../models/Employee.js';
import { LeaveRequest } from '../models/LeaveRequest.js';
import { PayrollRun } from '../models/PayrollRun.js';
import { Payslip } from '../models/Payslip.js';
import { SalaryStructure } from '../models/SalaryStructure.js';
import { ApiError } from '../utils/ApiError.js';
import { eachDay, isWorkingDay } from '../utils/dates.js';
import { computeLine } from '../utils/payroll.js';
import { round2 } from '../utils/salary.js';
import { getCompany, holidaySet, oid, ownEmployee, todayKey } from './context.js';
import { sweepMissingCheckouts } from './attendanceService.js';
import { notify } from './notificationService.js';
import { recordAudit } from './auditService.js';

const monthEnd = (m) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).toISOString().slice(0, 10);
const key = (d) => d.toISOString().slice(0, 10);

/** Create or refresh the DRAFT for a month. Finalized months cannot be regenerated. */
export async function generateDraft(actor, { month }) {
  const company = await getCompany();
  const tk = await todayKey(company);
  const from = `${month}-01`, to = monthEnd(month);
  if (from > tk) throw new ApiError(422, 'Cannot run payroll for a future month', [{ field: 'month', reason: 'Month has not started' }]);
  const existing = await PayrollRun.findOne({ month });
  if (existing?.status === 'finalized') throw new ApiError(409, `Payroll for ${month} is finalized and locked`);

  const holidays = await holidaySet(from, to);
  const workingDays = [...eachDay(from, to)].filter((d) => isWorkingDay(d, company.weekend, holidays)).length;
  if (workingDays === 0) throw new ApiError(422, 'This month has no working days');
  await sweepMissingCheckouts(company);

  const employees = await Employee.find({
    joiningDate: { $lte: new Date(`${to}T23:59:59Z`) },
    $or: [{ leavingDate: null }, { leavingDate: { $gte: new Date(`${from}T00:00:00Z`) } }],
  }).populate('department', 'name').populate('designation', 'title').populate('user', 'role').lean();
  const ids = employees.map((e) => e._id);

  const [salaries, atts, leaves] = await Promise.all([
    SalaryStructure.aggregate([
      { $match: { employee: { $in: ids }, effectiveFrom: { $lte: new Date(`${to}T23:59:59Z`) } } },
      { $sort: { effectiveFrom: -1, createdAt: -1 } },
      { $group: { _id: '$employee', basic: { $first: '$basic' }, hra: { $first: '$hra' }, medical: { $first: '$medical' }, gross: { $first: '$gross' } } },
    ]),
    Attendance.find({ employee: { $in: ids }, date: { $gte: from, $lte: to } }).select('employee date status').lean(),
    LeaveRequest.find({ employee: { $in: ids }, status: 'approved', startDate: { $lte: to }, endDate: { $gte: from } }).populate('leaveType', 'isPaid').lean(),
  ]);
  const salaryBy = new Map(salaries.map((s) => [String(s._id), s]));
  const recsBy = new Map();
  for (const a of atts) { const k = String(a.employee); if (!recsBy.has(k)) recsBy.set(k, new Map()); recsBy.get(k).set(a.date, a.status); }
  const leaveBy = new Map();
  for (const l of leaves) {
    const k = String(l.employee); if (!leaveBy.has(k)) leaveBy.set(k, { any: new Set(), unpaid: new Set() });
    for (const d of eachDay(l.startDate < from ? from : l.startDate, l.endDate > to ? to : l.endDate)) { leaveBy.get(k).any.add(d); if (l.leaveType?.isPaid === false) leaveBy.get(k).unpaid.add(d); }
  }

  const slips = [], skipped = [];
  for (const e of employees) {
    const k = String(e._id);
    const salary = salaryBy.get(k);
    if (!salary) { skipped.push({ employeeCode: e.employeeCode, name: e.name, reason: 'No salary structure effective for this month' }); continue; }
    const winStart = key(e.joiningDate) > from ? key(e.joiningDate) : from;
    const winEnd = e.leavingDate && key(e.leavingDate) < to ? key(e.leavingDate) : to;
    if (winStart > winEnd) continue;
    const windowDates = [...eachDay(winStart, winEnd)].filter((d) => isWorkingDay(d, company.weekend, holidays));
    if (windowDates.length === 0) continue; // joined/left outside any working day: nothing payable
    const lv = leaveBy.get(k) || { any: new Set(), unpaid: new Set() };
    const line = computeLine({ gross: salary.gross, monthWorkingDays: workingDays, windowDates, records: recsBy.get(k) || new Map(), unpaidLeave: lv.unpaid, anyLeave: lv.any, todayKey: tk });
    slips.push({
      employee: e._id, month, employeeName: e.name, employeeCode: e.employeeCode, department: e.department?.name, designation: e.designation?.title,
      isAdminAccount: e.user?.role === 'admin', workingDays, ...line,
      salary: { basic: salary.basic, hra: salary.hra, medical: salary.medical, gross: salary.gross },
    });
  }
  const sum = (f) => round2(slips.reduce((t, s) => t + f(s), 0));
  const totals = { headcount: slips.length, gross: sum((s) => s.proratedGross), deductions: sum((s) => s.deductions.absence + s.deductions.unpaidLeave + s.deductions.halfDay), tax: sum((s) => s.tax), net: sum((s) => s.net) };

  let run;
  if (existing) {
    await Payslip.deleteMany({ run: existing._id, locked: false });
    run = await PayrollRun.findOneAndUpdate({ _id: existing._id, status: 'draft' }, { workingDays, totals, skipped, generatedBy: actor._id, generatedAt: new Date() }, { new: true });
    if (!run) throw new ApiError(409, `Payroll for ${month} was finalized meanwhile`);
  } else {
    run = await PayrollRun.create({ month, workingDays, totals, skipped, generatedBy: actor._id, generatedAt: new Date() });
  }
  if (slips.length) await Payslip.insertMany(slips.map((s) => ({ ...s, run: run._id })));
  await recordAudit(actor, existing ? 'payroll.draft_regenerated' : 'payroll.draft_created', 'PayrollRun', run._id, existing?.toObject?.().totals, totals);
  return run;
}

export const listRuns = () => PayrollRun.find().sort({ month: -1 }).lean();

export async function getRun(actor, id, { page, limit, search }) {
  const run = await PayrollRun.findById(id).lean();
  if (!run) throw new ApiError(404, 'Payroll run not found');
  const filter = { run: run._id, ...(actor.role === 'hr' ? { isAdminAccount: false } : {}) };
  if (search) { const r = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); filter.$or = [{ employeeName: r }, { employeeCode: r }]; }
  const [items, total] = await Promise.all([Payslip.find(filter).sort({ employeeName: 1 }).skip((page - 1) * limit).limit(limit).lean(), Payslip.countDocuments(filter)]);
  return { run, items, meta: { page, limit, total, pages: Math.ceil(total / limit) } };
}

/** Admin only (enforced in the route). Atomic: only one caller can move draft -> finalized. */
export async function finalizeRun(actor, id) {
  const run = await PayrollRun.findById(id);
  if (!run) throw new ApiError(404, 'Payroll run not found');
  if (run.status === 'finalized') throw new ApiError(409, 'Payroll is already finalized');
  if (monthEnd(run.month) >= (await todayKey())) throw new ApiError(422, `${run.month} has not ended yet. Finalize after the last day of the month.`);
  if (run.totals.headcount === 0) throw new ApiError(422, 'There are no payslips to finalize');
  const before = { status: run.status, totals: run.totals };
  const done = await PayrollRun.findOneAndUpdate({ _id: id, status: 'draft' }, { status: 'finalized', finalizedBy: actor._id, finalizedAt: new Date() }, { new: true });
  if (!done) throw new ApiError(409, 'Payroll is already finalized');
  await Payslip.updateMany({ run: id }, { locked: true }).setOptions({ allowFinalize: true });
  await recordAudit(actor, 'payroll.finalized', 'PayrollRun', id, before, { status: 'finalized', totals: done.totals, finalizedAt: done.finalizedAt });
  const slips = await Payslip.find({ run: id }).select('employee month').populate({ path: 'employee', select: 'user' }).lean();
  await Promise.all(slips.map((s) => notify(s.employee.user, 'payslip', `Payslip ready: ${s.month}`, 'Your payslip is available to download.', '/payslips')));
  return done;
}

export async function listOwnPayslips(actor) {
  const emp = await ownEmployee(actor);
  return Payslip.find({ employee: emp._id, locked: true }).sort({ month: -1 }).lean();
}

/** Employees: own + finalized only. HR/Admin: any state, but HR never sees Admin accounts. */
export async function getPayslip(actor, id) {
  const slip = await Payslip.findById(id).lean();
  if (!slip) throw new ApiError(404, 'Payslip not found');
  if (actor.role === 'employee') {
    const emp = await ownEmployee(actor);
    if (String(slip.employee) !== String(emp._id) || !slip.locked) throw new ApiError(404, 'Payslip not found');
  } else if (actor.role === 'hr' && slip.isAdminAccount) throw new ApiError(403, 'HR cannot access Admin accounts');
  return slip;
}
