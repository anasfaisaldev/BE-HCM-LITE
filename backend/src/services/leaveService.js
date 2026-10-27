import { Employee } from '../models/Employee.js';
import { LeaveRequest } from '../models/LeaveRequest.js';
import { LeaveType } from '../models/LeaveType.js';
import { ApiError } from '../utils/ApiError.js';
import { countWorkingDays, isDateKey } from '../utils/dates.js';
import { exceedsQuota, remaining } from '../utils/rules.js';
import { assertScope, getCompany, holidaySet, oid, ownEmployee, todayKey } from './context.js';
import { notify } from './notificationService.js';
import { recordAudit } from './auditService.js';

async function usedDays(employeeId, year, typeId) {
  const rows = await LeaveRequest.aggregate([
    { $match: { employee: oid(employeeId), year, leaveType: oid(typeId), status: { $in: ['pending', 'approved'] } } },
    { $group: { _id: '$status', days: { $sum: '$days' } } },
  ]);
  const get = (s) => rows.find((r) => r._id === s)?.days || 0;
  return { approved: get('approved'), pending: get('pending') };
}

export async function getBalances(actor, { employeeId, year }) {
  let emp;
  if (employeeId && actor.role !== 'employee') {
    emp = await Employee.findById(employeeId).populate('user', 'role');
    if (!emp) throw new ApiError(404, 'Employee not found');
    assertScope(actor, emp);
  } else emp = await ownEmployee(actor);
  const y = year || new Date().getUTCFullYear();
  const types = await LeaveType.find().sort({ name: 1 }).lean();
  const balances = await Promise.all(types.map(async (t) => {
    const { approved, pending } = await usedDays(emp._id, y, t._id);
    return { leaveType: { _id: t._id, name: t.name, code: t.code, isPaid: t.isPaid }, quota: t.annualQuota, used: approved, pending, remaining: remaining(t.annualQuota, approved, pending) };
  }));
  return { employeeId: emp._id, year: y, balances };
}

export async function applyLeave(actor, { leaveType, startDate, endDate, reason }) {
  const emp = await ownEmployee(actor);
  const company = await getCompany();
  const type = await LeaveType.findById(leaveType);
  if (!type) throw new ApiError(422, 'Unknown leave type', [{ field: 'leaveType', reason: 'Not found' }]);
  if (!isDateKey(startDate)) throw new ApiError(422, 'Invalid start date', [{ field: 'startDate', reason: 'Use YYYY-MM-DD' }]);
  if (!isDateKey(endDate)) throw new ApiError(422, 'Invalid end date', [{ field: 'endDate', reason: 'Use YYYY-MM-DD' }]);
  if (endDate < startDate) throw new ApiError(422, 'End date is before start date', [{ field: 'endDate', reason: 'Must not be before start date' }]);
  if (startDate.slice(0, 4) !== endDate.slice(0, 4)) throw new ApiError(422, 'Leave cannot span two calendar years. Submit one request per year.', [{ field: 'endDate', reason: 'Same year as start date' }]);
  if (startDate < emp.joiningDate.toISOString().slice(0, 10)) throw new ApiError(422, 'Leave cannot start before your joining date', [{ field: 'startDate', reason: 'Before joining date' }]);

  const days = countWorkingDays(startDate, endDate, company.weekend, await holidaySet(startDate, endDate));
  if (days === 0) throw new ApiError(422, 'These dates contain no working days (weekends and public holidays are excluded)', [{ field: 'startDate', reason: 'No working days in range' }]);

  const clash = await LeaveRequest.findOne({ employee: emp._id, status: { $in: ['pending', 'approved'] }, startDate: { $lte: endDate }, endDate: { $gte: startDate } }).lean();
  if (clash) throw new ApiError(422, `Overlaps an existing ${clash.status} request (${clash.startDate} to ${clash.endDate})`, [{ field: 'startDate', reason: 'Overlapping request' }]);

  const year = Number(startDate.slice(0, 4));
  const { approved, pending } = await usedDays(emp._id, year, type._id);
  if (exceedsQuota(type.annualQuota, approved + pending, days)) {
    throw new ApiError(422, `Insufficient ${type.name} balance: ${remaining(type.annualQuota, approved, pending)} day(s) left, ${days} requested`, [{ field: 'leaveType', reason: 'Over balance' }]);
  }
  const req = await LeaveRequest.create({ employee: emp._id, leaveType: type._id, startDate, endDate, year, days, reason });
  await recordAudit(actor, 'leave.requested', 'LeaveRequest', req._id, null, req.toObject());
  return req;
}

export async function cancelLeave(actor, id) {
  const req = await LeaveRequest.findById(id);
  if (!req) throw new ApiError(404, 'Leave request not found');
  const emp = await ownEmployee(actor);
  if (String(req.employee) !== String(emp._id)) throw new ApiError(403, 'You can only cancel your own requests');
  const tk = await todayKey();
  const cancellable = req.status === 'pending' || (req.status === 'approved' && req.startDate > tk);
  if (!cancellable) throw new ApiError(422, 'Only pending requests, or approved leave that has not started, can be cancelled');
  const before = req.toObject();
  req.status = 'cancelled';
  await req.save();
  await recordAudit(actor, 'leave.cancelled', 'LeaveRequest', req._id, before, req.toObject());
  return req;
}

export async function decideLeave(actor, id, { decision, comment }) {
  const req = await LeaveRequest.findById(id);
  if (!req) throw new ApiError(404, 'Leave request not found');
  const emp = await Employee.findById(req.employee).populate('user', 'role');
  if (String(emp.user._id) === String(actor._id)) throw new ApiError(403, 'You cannot decide your own request');
  assertScope(actor, emp);
  if (req.status !== 'pending') throw new ApiError(409, `Request is already ${req.status}`);
  if (decision === 'rejected' && !comment) throw new ApiError(422, 'A comment is required when rejecting', [{ field: 'comment', reason: 'Required' }]);
  const type = await LeaveType.findById(req.leaveType);
  if (decision === 'approved') {
    const { approved, pending } = await usedDays(emp._id, req.year, type._id); // pending already includes this request
    if (type.annualQuota != null && approved + pending > type.annualQuota) throw new ApiError(422, 'Approving would exceed the current quota for this leave type');
  }
  const before = req.toObject();
  Object.assign(req, { status: decision, decidedBy: actor._id, decisionComment: comment, decidedAt: new Date() });
  await req.save();
  await recordAudit(actor, `leave.${decision}`, 'LeaveRequest', req._id, before, req.toObject());
  await notify(emp.user._id, 'leave_decision', `Leave ${decision}`, `${type.name} ${req.startDate} to ${req.endDate}${comment ? `: ${comment}` : ''}`, '/leave');
  return req;
}

export async function listLeave(actor, { status, page, limit }) {
  const filter = status ? { status } : {};
  if (actor.role === 'employee') filter.employee = (await ownEmployee(actor))._id;
  const [items, total] = await Promise.all([
    LeaveRequest.find(filter).populate('employee', 'name employeeCode').populate('leaveType', 'name').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    LeaveRequest.countDocuments(filter),
  ]);
  return { items, meta: { page, limit, total, pages: Math.ceil(total / limit) } };
}
