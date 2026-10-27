import mongoose from 'mongoose';
import { Company } from '../models/Company.js';
import { Employee } from '../models/Employee.js';
import { Holiday } from '../models/Holiday.js';
import { ApiError } from '../utils/ApiError.js';
import { localParts } from '../utils/dates.js';

export const oid = (id) => new mongoose.Types.ObjectId(String(id));

export async function getCompany() {
  const c = await Company.findOne({}).lean();
  if (!c) throw new ApiError(404, 'Company not set up');
  return c;
}
export async function todayKey(company) {
  return localParts(new Date(), (company || (await getCompany())).timezone).dateKey;
}
export async function ownEmployee(actor) {
  const e = await Employee.findOne({ user: actor._id });
  if (!e) throw new ApiError(404, 'No employee profile is linked to this account');
  return e;
}
export async function holidaySet(from, to) {
  const rows = await Holiday.find({ date: { $gte: from, $lte: to } }).lean();
  return new Set(rows.map((h) => h.date));
}
/** HR may not act on Admin accounts' records; Employees only on their own. */
export function assertScope(actor, employee) {
  const owner = String(employee.user?._id || employee.user);
  if (actor.role === 'employee' && owner !== String(actor._id)) throw new ApiError(403, 'You can only access your own records');
  if (actor.role === 'hr' && employee.user?.role === 'admin') throw new ApiError(403, 'HR cannot access Admin accounts');
}
