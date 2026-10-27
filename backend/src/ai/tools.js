import { z } from 'zod';
import { Department } from '../models/Department.js';
import { Payslip } from '../models/Payslip.js';
import { PayrollRun } from '../models/PayrollRun.js';
import { ApiError } from '../utils/ApiError.js';
import { isDateKey } from '../utils/dates.js';
import { isToolAllowed, toolsForRole } from './toolPolicy.js';
import * as dash from '../services/dashboardService.js';
import * as employees from '../services/employeeService.js';
import { getBalances } from '../services/leaveService.js';
import { ownEmployee } from '../services/context.js';

/**
 * The model never touches the database. Each tool below calls the SAME service functions the REST
 * dashboards use, with the signed-in user as actor, so scope rules (employee = own record, HR = no
 * Admin accounts) apply automatically. isToolAllowed is checked again on every call.
 */
const date = z.string().refine(isDateKey, 'Use YYYY-MM-DD').optional();
const range = { from: date, to: date, department: z.string().trim().max(80).optional() };

async function resolveDept(name) {
  if (!name) return undefined;
  const d = await Department.findOne({ name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).lean();
  if (!d) throw new ApiError(422, `Unknown department "${name}"`);
  return String(d._id);
}
const scopeFor = async (actor, i) => dash.buildScope(actor, { from: i.from, to: i.to, department: await resolveDept(i.department) });

const defs = {
  get_headcount: {
    description: 'Current headcount (employees in service) and headcount by department. Optional department name and as-of date (to).',
    schema: z.object({ to: date, department: range.department }),
    properties: { to: { type: 'string', description: 'As-of date YYYY-MM-DD (default today)' }, department: { type: 'string' } },
    run: async (actor, i) => dash.headcountSummary(await scopeFor(actor, { to: i.to, department: i.department })),
  },
  get_attendance_summary: {
    description: 'Attendance counts and rates (attendance rate, late %, absenteeism %) for a date range. Employees get only their own data.',
    schema: z.object(range),
    properties: { from: { type: 'string' }, to: { type: 'string' }, department: { type: 'string' } },
    run: async (actor, i) => { const { byDate, byDept, topLateComers, ...rest } = await dash.attendanceStats(await scopeFor(actor, i)); return actor.role === 'employee' ? rest : { ...rest, topLateComers }; },
  },
  get_late_comers: {
    description: 'Top five employees by number of late arrivals in a date range (HR/Admin only).',
    schema: z.object(range),
    properties: { from: { type: 'string' }, to: { type: 'string' }, department: { type: 'string' } },
    run: async (actor, i) => ({ topLateComers: (await dash.attendanceStats(await scopeFor(actor, i))).topLateComers }),
  },
  get_leave_summary: {
    description: 'Approved leave days by leave type with utilization %, plus pending leave/correction counts (HR/Admin only).',
    schema: z.object(range),
    properties: { from: { type: 'string' }, to: { type: 'string' }, department: { type: 'string' } },
    run: async (actor, i) => dash.leaveSummary(await scopeFor(actor, i)),
  },
  get_my_leave_balance: {
    description: "The signed-in user's own leave balance per leave type for the current year.",
    schema: z.object({}),
    properties: {},
    run: async (actor) => getBalances(actor, {}),
  },
  get_payroll_summary: {
    description: 'HR/Admin: payroll run totals for a month (YYYY-MM, default latest). Employees: only their own latest finalized payslip numbers.',
    schema: z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional() }),
    properties: { month: { type: 'string', description: 'YYYY-MM' } },
    run: async (actor, i) => {
      if (actor.role === 'employee') {
        const emp = await ownEmployee(actor);
        const s = await Payslip.findOne({ employee: emp._id, locked: true, ...(i.month ? { month: i.month } : {}) }).sort({ month: -1 }).lean();
        return s ? { month: s.month, gross: s.proratedGross, deductions: s.deductions, tax: s.tax, net: s.net } : { message: 'No finalized payslip found' };
      }
      const run = await PayrollRun.findOne(i.month ? { month: i.month } : {}).sort({ month: -1 }).lean();
      return run ? { month: run.month, status: run.status, workingDays: run.workingDays, totals: run.totals } : { message: 'No payroll run found' };
    },
  },
  search_employees: {
    description: 'Find employees by name, email or code (HR/Admin only). Returns directory fields only, never salary.',
    schema: z.object({ query: z.string().trim().min(1).max(60), department: range.department }),
    properties: { query: { type: 'string' }, department: { type: 'string' } },
    run: async (actor, i) => {
      const { items } = await employees.listEmployees({ search: i.query, department: await resolveDept(i.department), page: 1, limit: 10 });
      return items.filter((e) => !(actor.role === 'hr' && e.user?.role === 'admin'))
        .map((e) => ({ code: e.employeeCode, name: e.name, email: e.email, department: e.department?.name, designation: e.designation?.title, status: e.status }));
    },
  },
};

export const toolSpecs = (role) => toolsForRole(role).map((n) => ({
  name: n, description: defs[n].description, input_schema: { type: 'object', properties: defs[n].properties, ...(n === 'search_employees' ? { required: ['query'] } : {}) },
}));

export async function executeTool(actor, name, input) {
  if (!defs[name] || !isToolAllowed(actor.role, name)) throw new ApiError(403, `Your role is not permitted to use ${name}`);
  const parsed = defs[name].schema.safeParse(input || {});
  if (!parsed.success) throw new ApiError(422, `Invalid input for ${name}: ${parsed.error.issues.map((x) => x.message).join(', ')}`);
  return defs[name].run(actor, parsed.data);
}
