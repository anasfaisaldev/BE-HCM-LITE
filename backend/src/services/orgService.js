import { Company } from '../models/Company.js';
import { Department } from '../models/Department.js';
import { Designation } from '../models/Designation.js';
import { LeaveType } from '../models/LeaveType.js';
import { Holiday } from '../models/Holiday.js';
import { ApiError } from '../utils/ApiError.js';
import { recordAudit } from './auditService.js';

export async function getOrg() {
  const [company, departments, designations, leaveTypes, holidays] = await Promise.all([
    Company.findOne({}).lean(),
    Department.find().sort({ name: 1 }).lean(),
    Designation.find().sort({ title: 1 }).lean(),
    LeaveType.find().sort({ name: 1 }).lean(),
    Holiday.find().sort({ date: 1 }).lean(),
  ]);
  return { company, departments, designations, leaveTypes, holidays };
}

export async function updateSettings(actor, patch) {
  const company = await Company.findOne({});
  if (!company) throw new ApiError(404, 'Company not set up');
  const before = company.toObject();
  const { geo, ...rest } = patch;
  company.set(rest);
  if (geo) company.set('geo', { ...before.geo, ...geo });
  if (company.requireCameraCheckIn && (company.geo?.lat == null || company.geo?.lng == null)) {
    throw new ApiError(422, 'Set the office latitude and longitude before requiring camera check-in', [{ field: 'geo.lat', reason: 'Office location required' }]);
  }
  await company.save();
  await recordAudit(actor, 'org.settings_updated', 'Company', company._id, before, company.toObject());
  return company;
}

export async function createDepartment(actor, { name }) {
  const dep = await Department.create({ name });
  await recordAudit(actor, 'department.created', 'Department', dep._id, null, dep.toObject());
  return dep;
}

export async function createDesignation(actor, { title }) {
  const des = await Designation.create({ title });
  await recordAudit(actor, 'designation.created', 'Designation', des._id, null, des.toObject());
  return des;
}

const DEFAULT_LEAVE_TYPES = [
  { name: 'Annual Leave', code: 'annual', annualQuota: 14, isPaid: true },
  { name: 'Sick Leave', code: 'sick', annualQuota: 8, isPaid: true },
  { name: 'Casual Leave', code: 'casual', annualQuota: 10, isPaid: true },
  { name: 'Unpaid Leave', code: 'unpaid', annualQuota: null, isPaid: false },
];
export async function ensureDefaultLeaveTypes() {
  if ((await LeaveType.estimatedDocumentCount()) === 0) await LeaveType.insertMany(DEFAULT_LEAVE_TYPES);
}

export async function createLeaveType(actor, input) {
  const lt = await LeaveType.create(input);
  await recordAudit(actor, 'leave_type.created', 'LeaveType', lt._id, null, lt.toObject());
  return lt;
}
export async function updateLeaveType(actor, id, patch) {
  const lt = await LeaveType.findById(id);
  if (!lt) throw new ApiError(404, 'Leave type not found');
  const before = lt.toObject();
  lt.set(patch);
  await lt.save(); // quota changes affect balance checks on new requests only
  await recordAudit(actor, 'leave_type.updated', 'LeaveType', lt._id, before, lt.toObject());
  return lt;
}
export async function createHoliday(actor, input) {
  const h = await Holiday.create(input);
  await recordAudit(actor, 'holiday.created', 'Holiday', h._id, null, h.toObject());
  return h;
}
export async function deleteHoliday(actor, id) {
  const h = await Holiday.findByIdAndDelete(id);
  if (!h) throw new ApiError(404, 'Holiday not found');
  await recordAudit(actor, 'holiday.deleted', 'Holiday', h._id, h.toObject(), null);
}
