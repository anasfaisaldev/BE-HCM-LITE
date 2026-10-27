import { Attendance } from '../models/Attendance.js';
import { AttendanceCorrection } from '../models/AttendanceCorrection.js';
import { AuditLog } from '../models/AuditLog.js';
import { Department } from '../models/Department.js';
import { Employee } from '../models/Employee.js';
import { LeaveRequest } from '../models/LeaveRequest.js';
import { Payslip } from '../models/Payslip.js';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { addDays, dayType, dow, eachDay } from '../utils/dates.js';
import { absenteeism, attendanceRate, attritionPct, latePct, leaveUtilization } from '../utils/metrics.js';
import { classifyDay } from '../utils/rules.js';
import { round2 } from '../utils/salary.js';
import { getCompany, holidaySet, oid, ownEmployee, todayKey } from './context.js';
import { sweepMissingCheckouts } from './attendanceService.js';
import { getBalances } from './leaveService.js';
import { listAnnouncements } from './announcementService.js';

const MAX_RANGE_DAYS = 93;
const endOf = (d) => new Date(`${d}T23:59:59.999Z`);
const startOf = (d) => new Date(`${d}T00:00:00.000Z`);

/**
 * Resolves filters + role scope once. All metrics read this scope, so every number on a dashboard
 * (and every AI tool answer) uses identical definitions.
 *  - HR never sees Admin accounts' records. Employees are forced to their own record (onlyEmployee).
 */
export async function buildScope(actor, { from, to, department } = {}) {
  const company = await getCompany();
  const tk = await todayKey(company);
  const end = to || tk;
  const start = from || `${end.slice(0, 7)}-01`;
  if (start > end) throw new ApiError(422, 'From date is after To date', [{ field: 'from', reason: 'Must not be after To' }]);
  if ([...eachDay(start, end)].length > MAX_RANGE_DAYS) throw new ApiError(422, `Date range is limited to ${MAX_RANGE_DAYS} days`, [{ field: 'to', reason: 'Range too long' }]);
  let excluded = [];
  if (actor.role === 'hr') {
    const admins = await User.find({ role: 'admin' }).select('_id').lean();
    excluded = (await Employee.find({ user: { $in: admins.map((a) => a._id) } }).select('_id').lean()).map((e) => e._id);
  }
  const onlyEmployee = actor.role === 'employee' ? (await ownEmployee(actor))._id : null;
  return { company, tk, from: start, to: end, department: department || null, excluded, onlyEmployee };
}

const baseFilter = (sc) => ({
  ...(sc.department ? { department: oid(sc.department) } : {}),
  ...(sc.onlyEmployee ? { _id: sc.onlyEmployee } : sc.excluded.length ? { _id: { $nin: sc.excluded } } : {}),
});
/** In service on `at` = joined on/before it and (no leaving date or last day >= it). */
const inService = (sc, at) => ({ ...baseFilter(sc), joiningDate: { $lte: endOf(at) }, $or: [{ leavingDate: null }, { leavingDate: { $gte: startOf(at) } }] });
const lookupDept = [{ $lookup: { from: 'departments', localField: '_id', foreignField: '_id', as: 'd' } }, { $project: { _id: 0, id: '$_id', name: { $ifNull: [{ $arrayElemAt: ['$d.name', 0] }, 'Unassigned'] }, count: 1 } }];

export const headcountAt = (sc, at) => Employee.countDocuments(inService(sc, at));

export async function headcountSummary(sc) {
  const [headcount, byDepartment] = await Promise.all([
    headcountAt(sc, sc.to),
    Employee.aggregate([{ $match: { ...inService(sc, sc.to), ...(baseFilter(sc)._id ? { _id: baseFilter(sc)._id } : {}) } }, { $group: { _id: '$department', count: { $sum: 1 } } }, ...lookupDept, { $sort: { count: -1 } }]),
  ]);
  return { asOf: sc.to, headcount, byDepartment };
}

export async function attritionYtd(sc) {
  const yearStart = `${sc.to.slice(0, 4)}-01-01`;
  const [leavers, startHc, endHc] = await Promise.all([
    Employee.countDocuments({ ...baseFilter(sc), leavingDate: { $gte: startOf(yearStart), $lte: endOf(sc.to) } }),
    headcountAt(sc, addDays(yearStart, -1)), headcountAt(sc, sc.to),
  ]);
  return { leavers, startHeadcount: startHc, endHeadcount: endHc, ratePct: attritionPct(leavers, startHc, endHc) };
}

async function payrollCost(sc) {
  const dep = sc.department ? await Department.findById(sc.department).lean() : null;
  const match = { locked: true, month: { $gte: sc.from.slice(0, 7), $lte: sc.to.slice(0, 7) }, ...(dep ? { department: dep.name } : {}) };
  const [total, byDept] = await Promise.all([
    Payslip.aggregate([{ $match: match }, { $group: { _id: null, gross: { $sum: '$proratedGross' }, net: { $sum: '$net' }, tax: { $sum: '$tax' }, slips: { $sum: 1 } } }]),
    Payslip.aggregate([{ $match: match }, { $group: { _id: '$department', gross: { $sum: '$proratedGross' }, net: { $sum: '$net' } } }, { $project: { _id: 0, name: { $ifNull: ['$_id', 'Unassigned'] }, gross: { $round: ['$gross', 2] }, net: { $round: ['$net', 2] } } }, { $sort: { gross: -1 } }]),
  ]);
  const t = total[0] || { gross: 0, net: 0, tax: 0, slips: 0 };
  return { basis: 'Finalized payslips only, months overlapping the range', gross: round2(t.gross), net: round2(t.net), tax: round2(t.tax), payslips: t.slips, byDepartment: byDept };
}

async function salaryStats(sc) {
  const pipe = [
    { $match: inService(sc, sc.to) },
    { $lookup: { from: 'salarystructures', let: { id: '$_id' }, pipeline: [{ $match: { $expr: { $eq: ['$employee', '$$id'] }, effectiveFrom: { $lte: endOf(sc.to) } } }, { $sort: { effectiveFrom: -1, createdAt: -1 } }, { $limit: 1 }], as: 'sal' } },
    { $unwind: '$sal' },
  ];
  const [all, byDept, byDesig] = await Promise.all([
    Employee.aggregate([...pipe, { $group: { _id: null, avg: { $avg: '$sal.gross' }, n: { $sum: 1 } } }]),
    Employee.aggregate([...pipe, { $group: { _id: '$department', avg: { $avg: '$sal.gross' }, count: { $sum: 1 } } }, ...lookupDept.slice(0, 1), { $project: { _id: 0, name: { $ifNull: [{ $arrayElemAt: ['$d.name', 0] }, 'Unassigned'] }, avgGross: { $round: ['$avg', 2] }, count: 1 } }, { $sort: { avgGross: -1 } }]),
    Employee.aggregate([...pipe, { $group: { _id: '$designation', avg: { $avg: '$sal.gross' }, count: { $sum: 1 } } }, { $lookup: { from: 'designations', localField: '_id', foreignField: '_id', as: 'd' } }, { $project: { _id: 0, name: { $ifNull: [{ $arrayElemAt: ['$d.title', 0] }, 'Unassigned'] }, avgGross: { $round: ['$avg', 2] }, count: 1 } }, { $sort: { avgGross: -1 } }]),
  ]);
  return { averageGross: all[0] ? round2(all[0].avg) : null, employeesWithSalary: all[0]?.n || 0, byDepartment: byDept, byDesignation: byDesig };
}

async function demographics(sc) {
  const [gender, tenure] = await Promise.all([
    Employee.aggregate([{ $match: inService(sc, sc.to) }, { $group: { _id: { $ifNull: ['$gender', 'unspecified'] }, count: { $sum: 1 } } }, { $project: { _id: 0, label: '$_id', count: 1 } }, { $sort: { count: -1 } }]),
    Employee.aggregate([{ $match: inService(sc, sc.to) }, { $project: { years: { $divide: [{ $subtract: [endOf(sc.to), '$joiningDate'] }, 31557600000] } } },
      { $bucket: { groupBy: '$years', boundaries: [-1000, 1, 3, 5, 1000], default: 'other', output: { count: { $sum: 1 } } } }]),
  ]);
  const labels = { '-1000': 'Under 1 year', 1: '1 to 3 years', 3: '3 to 5 years', 5: '5+ years' };
  return { gender, tenure: tenure.map((b) => ({ label: labels[b._id] || 'Other', count: b.count })) };
}

/**
 * Attendance over [from,to]. Per in-service employee and working day, classifyDay (the same rule the
 * calendar and payroll use) assigns one status; today's not_checked_in and future days are excluded.
 * Absent is derived, so this uses one bounded scan of the range instead of a pure $group.
 */
export async function attendanceStats(sc) {
  await sweepMissingCheckouts(sc.company);
  const emps = await Employee.find({ ...baseFilter(sc), joiningDate: { $lte: endOf(sc.to) }, $or: [{ leavingDate: null }, { leavingDate: { $gte: startOf(sc.from) } }] })
    .select('name employeeCode department joiningDate leavingDate').populate('department', 'name').lean();
  const ids = emps.map((e) => e._id);
  const [recs, leaves, holidays] = await Promise.all([
    Attendance.find({ employee: { $in: ids }, date: { $gte: sc.from, $lte: sc.to } }).select('employee date status').lean(),
    LeaveRequest.find({ employee: { $in: ids }, status: 'approved', startDate: { $lte: sc.to }, endDate: { $gte: sc.from } }).select('employee startDate endDate').lean(),
    holidaySet(sc.from, sc.to),
  ]);
  const recBy = new Map(recs.map((r) => [`${r.employee}|${r.date}`, r]));
  const leaveDays = new Set();
  for (const l of leaves) for (const d of eachDay(l.startDate < sc.from ? sc.from : l.startDate, l.endDate > sc.to ? sc.to : l.endDate)) leaveDays.add(`${l.employee}|${d}`);

  const totals = {}, byDate = {}, byDept = {}, lateBy = new Map();
  const bump = (o, k, s) => { (o[k] ||= {})[s] = (o[k][s] || 0) + 1; };
  for (const e of emps) {
    const joinKey = e.joiningDate.toISOString().slice(0, 10);
    const lastKey = e.leavingDate ? e.leavingDate.toISOString().slice(0, 10) : sc.to;
    const dept = e.department?.name || 'Unassigned';
    for (const d of eachDay(joinKey > sc.from ? joinKey : sc.from, lastKey < sc.to ? lastKey : sc.to)) {
      const type = dayType(d, sc.company.weekend, holidays);
      if (type !== 'working') continue;
      const rec = recBy.get(`${e._id}|${d}`);
      const status = classifyDay({ dateKey: d, todayKey: sc.tk, joiningKey: joinKey, record: rec, onLeave: leaveDays.has(`${e._id}|${d}`), type });
      if (status === 'future' || status === 'not_checked_in' || status === 'n/a') continue;
      totals[status] = (totals[status] || 0) + 1; bump(byDate, d, status); bump(byDept, dept, status);
      if (status === 'late') lateBy.set(String(e._id), { employee: e.name, employeeCode: e.employeeCode, department: dept, lateCount: (lateBy.get(String(e._id))?.lateCount || 0) + 1 });
    }
  }
  return {
    from: sc.from, to: sc.to, totals,
    attendanceRatePct: attendanceRate(totals), latePct: latePct(totals), absenteeismPct: absenteeism(totals),
    byDate, byDept, topLateComers: [...lateBy.values()].sort((a, b) => b.lateCount - a.lateCount || a.employee.localeCompare(b.employee)).slice(0, 5),
  };
}

export async function leaveSummary(sc) {
  const ids = (await Employee.find({ ...baseFilter(sc) }).select('_id').lean()).map((e) => e._id);
  const [rows, headcount, pendingLeave, pendingCorr] = await Promise.all([
    LeaveRequest.aggregate([{ $match: { employee: { $in: ids }, status: 'approved', startDate: { $gte: sc.from, $lte: sc.to } } }, { $group: { _id: '$leaveType', days: { $sum: '$days' }, requests: { $sum: 1 } } },
      { $lookup: { from: 'leavetypes', localField: '_id', foreignField: '_id', as: 't' } }, { $unwind: '$t' }, { $project: { _id: 0, type: '$t.name', quota: '$t.annualQuota', days: 1, requests: 1 } }, { $sort: { days: -1 } }]),
    headcountAt(sc, sc.to),
    LeaveRequest.countDocuments({ employee: { $in: ids }, status: 'pending' }),
    AttendanceCorrection.countDocuments({ employee: { $in: ids }, status: 'pending' }),
  ]);
  return { from: sc.from, to: sc.to, byType: rows.map((r) => ({ ...r, utilizationPct: leaveUtilization(r.days, r.quota, headcount) })), pending: { leave: pendingLeave, corrections: pendingCorr } };
}

const trendOf = (a) => Object.keys(a.byDate).sort().map((d) => ({ date: d, ratePct: attendanceRate(a.byDate[d]) })).filter((x) => x.ratePct !== null);
const deptRows = (a, fn) => Object.entries(a.byDept).map(([name, t]) => ({ name, absenteeismPct: absenteeism(t), absent: t.absent || 0 })).sort((x, y) => (y.absenteeismPct ?? -1) - (x.absenteeismPct ?? -1));

async function adminDashboard(actor, sc) {
  const [hc, attr, pay, sal, demo, audit] = await Promise.all([headcountSummary(sc), attritionYtd(sc), payrollCost(sc), salaryStats(sc), demographics(sc),
    AuditLog.find().sort({ createdAt: -1 }).limit(8).lean()]);
  return { role: 'admin', filters: { from: sc.from, to: sc.to, department: sc.department }, kpis: { headcount: hc.headcount, attritionYtdPct: attr.ratePct, payrollCostGross: pay.gross, averageGross: sal.averageGross },
    headcountByDepartment: hc.byDepartment, attrition: attr, payroll: pay, salary: sal, gender: demo.gender, tenure: demo.tenure, auditFeed: audit };
}

async function hrDashboard(actor, sc) {
  const todaySc = { ...sc, from: sc.tk, to: sc.tk };
  const [hc, att, tod, leave] = await Promise.all([headcountSummary(sc), attendanceStats(sc), attendanceStats(todaySc), leaveSummary(sc)]);
  const checkedIn = (tod.totals.present || 0) + (tod.totals.late || 0) + (tod.totals.half_day || 0) + (tod.totals.missing_checkout || 0);
  return { role: 'hr', filters: { from: sc.from, to: sc.to, department: sc.department },
    kpis: { headcount: hc.headcount, presentToday: checkedIn, onLeaveToday: tod.totals.on_leave || 0, lateToday: tod.totals.late || 0, pendingApprovals: leave.pending.leave + leave.pending.corrections, pendingLeave: leave.pending.leave, pendingCorrections: leave.pending.corrections },
    attendance: { totals: att.totals, attendanceRatePct: att.attendanceRatePct, latePct: att.latePct, absenteeismPct: att.absenteeismPct },
    attendanceTrend: trendOf(att), absenteeismByDepartment: deptRows(att), leaveByType: leave.byType, topLateComers: att.topLateComers };
}

async function employeeDashboard(actor, sc) {
  const emp = await ownEmployee(actor);
  const today = new Date(`${sc.tk}T00:00:00Z`);
  const monday = addDays(sc.tk, -((dow(sc.tk) + 6) % 7));
  const sunday = addDays(monday, 6);
  const [week, late, balances, lastSlip, announcements] = await Promise.all([
    Attendance.aggregate([{ $match: { employee: emp._id, date: { $gte: monday, $lte: sunday } } }, { $group: { _id: null, minutes: { $sum: '$workedMinutes' } } }]),
    Attendance.countDocuments({ employee: emp._id, isLate: true, date: { $gte: `${sc.tk.slice(0, 7)}-01`, $lte: sc.tk } }),
    getBalances(actor, {}), Payslip.findOne({ employee: emp._id, locked: true }).sort({ month: -1 }).lean(), listAnnouncements(),
  ]);
  void today;
  const target = sc.company.rules.weeklyHours;
  const hours = round2((week[0]?.minutes || 0) / 60);
  return { role: 'employee', week: { from: monday, to: sunday, hours, targetHours: target, progressPct: Math.min(100, round2((hours / target) * 100)), note: 'Counts completed days (after check-out)' },
    lateCountThisMonth: late, leaveBalances: balances.balances, lastPayslip: lastSlip ? { _id: lastSlip._id, month: lastSlip.month, net: lastSlip.net } : null, announcements };
}

export async function getDashboard(actor, filters) {
  const sc = await buildScope(actor, actor.role === 'employee' ? {} : filters);
  const data = actor.role === 'admin' ? await adminDashboard(actor, sc) : actor.role === 'hr' ? await hrDashboard(actor, sc) : await employeeDashboard(actor, sc);
  if (actor.role !== 'employee') data.announcements = await listAnnouncements();
  return data;
}

/** The exact KPI JSON handed to the AI summary: same numbers as the dashboard, minus audit/announcement text. */
export async function kpiForAI(actor, filters) {
  const d = await getDashboard(actor, filters);
  delete d.auditFeed; delete d.announcements;
  return d;
}
