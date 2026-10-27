import { Attendance } from '../models/Attendance.js';
import { AttendanceCorrection } from '../models/AttendanceCorrection.js';
import { Employee } from '../models/Employee.js';
import { LeaveRequest } from '../models/LeaveRequest.js';
import { ApiError } from '../utils/ApiError.js';
import { addDays, dayType, eachDay, isDateKey, localParts, zonedToUtc } from '../utils/dates.js';
import { classifyDay, finalStatus, isLate, minutesBetween } from '../utils/rules.js';
import { haversineMeters } from '../utils/geo.js';
import { assertScope, getCompany, holidaySet, oid, ownEmployee, todayKey } from './context.js';
import { notify } from './notificationService.js';
import { recordAudit } from './auditService.js';

/** A past day with a check-in but no check-out becomes missing_checkout (idempotent; run before reads). */
export async function sweepMissingCheckouts(company) {
  await Attendance.updateMany(
    { date: { $lt: await todayKey(company) }, checkOut: null, status: { $in: ['present', 'late'] } },
    { status: 'missing_checkout' }
  );
}

const MAX_ACCURACY_M = 100;
/**
 * Camera + GPS check. The client sends only raw readings; distance is computed here with Haversine.
 * Face count comes from the browser's detector, so it is a convenience check, not tamper-proof.
 * Nothing but the numeric result is stored (no photo).
 */
export function verifyCamera(company, v) {
  if (!v) {
    if (company.requireCameraCheckIn) throw new ApiError(422, 'Camera verification is required to check in or out', [{ field: 'verification', reason: 'Required' }], 'CAMERA_REQUIRED');
    return undefined;
  }
  if (v.faceCount !== 1) throw new ApiError(422, v.faceCount === 0 ? 'No face detected. Look at the camera.' : 'More than one face detected. Only you should be in view.', [{ field: 'faceCount', reason: 'Exactly one face required' }], 'FACE_CHECK_FAILED');
  if (company.geo?.lat == null || company.geo?.lng == null) throw new ApiError(422, 'The office location has not been configured by an Admin', undefined, 'OFFICE_NOT_CONFIGURED');
  if (v.accuracy > MAX_ACCURACY_M) throw new ApiError(422, `GPS accuracy is too low (${Math.round(v.accuracy)} m). It must be ${MAX_ACCURACY_M} m or better.`, [{ field: 'accuracy', reason: `Worse than ${MAX_ACCURACY_M} m` }], 'GPS_ACCURACY');
  const distance = haversineMeters(v.lat, v.lng, company.geo.lat, company.geo.lng);
  if (distance > company.geo.radiusMeters) throw new ApiError(422, `You are ${Math.round(distance)} m from the office; the allowed radius is ${company.geo.radiusMeters} m.`, [{ field: 'location', reason: 'Outside office radius' }], 'OUTSIDE_RADIUS');
  return { method: 'camera', faceCount: 1, distanceMeters: Math.round(distance * 10) / 10, accuracyMeters: Math.round(v.accuracy) };
}

export async function checkIn(actor, verification) {
  const [emp, company] = [await ownEmployee(actor), await getCompany()];
  const now = new Date(); // server clock only; the client never supplies a time
  const p = localParts(now, company.timezone);
  const late = isLate(p.secs, company.officeStart, company.graceMinutes);
  const proof = verifyCamera(company, verification);
  try {
    const rec = await Attendance.create({ employee: emp._id, date: p.dateKey, checkIn: now, isLate: late, status: late ? 'late' : 'present', ...(proof ? { verification: { in: proof } } : {}) });
    return rec;
  } catch (e) {
    if (e.code === 11000) throw new ApiError(409, 'You have already checked in today', undefined, 'ALREADY_CHECKED_IN');
    throw e;
  }
}

export async function checkOut(actor, verification) {
  const [emp, company] = [await ownEmployee(actor), await getCompany()];
  const now = new Date();
  const rec = await Attendance.findOne({ employee: emp._id, date: localParts(now, company.timezone).dateKey });
  if (!rec) throw new ApiError(422, 'You have not checked in today');
  if (rec.checkOut) throw new ApiError(409, 'You have already checked out today');
  const proof = verifyCamera(company, verification);
  if (proof) rec.set('verification.out', proof);
  rec.checkOut = now;
  rec.workedMinutes = minutesBetween(rec.checkIn, now);
  rec.status = finalStatus({ late: rec.isLate, workedMinutes: rec.workedMinutes, halfDayHours: company.rules.halfDayHours });
  await rec.save();
  return rec;
}

export async function today(actor) {
  const [emp, company] = [await ownEmployee(actor), await getCompany()];
  const date = await todayKey(company);
  return { date, serverTime: new Date(), requireCamera: !!company.requireCameraCheckIn, cameraConfigured: company.geo?.lat != null, record: await Attendance.findOne({ employee: emp._id, date }).lean() };
}

async function approvedLeaveDays(employeeIds, from, to) {
  const leaves = await LeaveRequest.find({ employee: { $in: employeeIds }, status: 'approved', startDate: { $lte: to }, endDate: { $gte: from } }).lean();
  const map = new Map(); // `${emp}|${date}` -> true
  for (const l of leaves) for (const d of eachDay(l.startDate < from ? from : l.startDate, l.endDate > to ? to : l.endDate)) map.set(`${l.employee}|${d}`, true);
  return map;
}

export async function calendar(actor, { month, employeeId }) {
  const company = await getCompany();
  await sweepMissingCheckouts(company);
  const emp = employeeId ? await Employee.findById(employeeId).populate('user', 'role') : await ownEmployee(actor).then((e) => e.populate('user', 'role'));
  if (!emp) throw new ApiError(404, 'Employee not found');
  assertScope(actor, emp);
  const from = `${month}-01`;
  const to = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).toISOString().slice(0, 10);
  const [recs, holidays, leave, tk] = await Promise.all([
    Attendance.find({ employee: emp._id, date: { $gte: from, $lte: to } }).lean(),
    holidaySet(from, to), approvedLeaveDays([emp._id], from, to), todayKey(company),
  ]);
  const byDate = new Map(recs.map((r) => [r.date, r]));
  const joiningKey = emp.joiningDate.toISOString().slice(0, 10);
  const summary = {};
  const days = [...eachDay(from, to)].map((date) => {
    const rec = byDate.get(date);
    const status = classifyDay({ dateKey: date, todayKey: tk, joiningKey, record: rec, onLeave: leave.has(`${emp._id}|${date}`), type: dayType(date, company.weekend, holidays) });
    summary[status] = (summary[status] || 0) + 1;
    return { date, status, checkIn: rec?.checkIn, checkOut: rec?.checkOut, workedMinutes: rec?.workedMinutes };
  });
  return { employee: { _id: emp._id, name: emp.name, employeeCode: emp.employeeCode }, month, days, summary };
}

export async function dailyBoard(actor, { date, department }) {
  const company = await getCompany();
  await sweepMissingCheckouts(company);
  const date_ = date || (await todayKey(company));
  const filter = { status: { $in: ['active', 'probation'] }, joiningDate: { $lte: new Date(`${date_}T23:59:59Z`) }, ...(department ? { department: oid(department) } : {}) };
  const emps = await Employee.find(filter).populate('department', 'name').populate('user', 'role').sort({ name: 1 }).lean();
  const visible = actor.role === 'hr' ? emps.filter((e) => e.user?.role !== 'admin') : emps; // HR never sees Admin accounts
  const ids = visible.map((e) => e._id);
  const [recs, holidays, leave, tk] = await Promise.all([Attendance.find({ employee: { $in: ids }, date: date_ }).lean(), holidaySet(date_, date_), approvedLeaveDays(ids, date_, date_), todayKey(company)]);
  const byEmp = new Map(recs.map((r) => [String(r.employee), r]));
  const totals = {};
  const rows = visible.map((e) => {
    const rec = byEmp.get(String(e._id));
    const status = classifyDay({ dateKey: date_, todayKey: tk, joiningKey: e.joiningDate.toISOString().slice(0, 10), record: rec, onLeave: leave.has(`${e._id}|${date_}`), type: dayType(date_, company.weekend, holidays) });
    totals[status] = (totals[status] || 0) + 1;
    return { employee: { _id: e._id, name: e.name, employeeCode: e.employeeCode, department: e.department?.name, role: e.user?.role }, status, checkIn: rec?.checkIn, checkOut: rec?.checkOut, workedMinutes: rec?.workedMinutes };
  });
  return { date: date_, totals, rows };
}

// ---- Corrections
export async function requestCorrection(actor, input) {
  const [emp, company] = [await ownEmployee(actor), await getCompany()];
  if (input.date > (await todayKey(company))) throw new ApiError(422, 'Cannot correct a future date', [{ field: 'date', reason: 'Must not be in the future' }]);
  if (input.date < emp.joiningDate.toISOString().slice(0, 10)) throw new ApiError(422, 'Date is before your joining date', [{ field: 'date', reason: 'Before joining date' }]);
  if (!input.checkIn && !input.checkOut) throw new ApiError(422, 'Provide a check-in or check-out time', [{ field: 'checkIn', reason: 'Provide at least one time' }]);
  if (input.checkIn && input.checkOut && input.checkOut <= input.checkIn) throw new ApiError(422, 'Check-out must be after check-in', [{ field: 'checkOut', reason: 'Must be after check-in' }]);
  if (await AttendanceCorrection.exists({ employee: emp._id, date: input.date, status: 'pending' })) throw new ApiError(409, 'A correction for this date is already pending');
  const c = await AttendanceCorrection.create({ employee: emp._id, ...input });
  await recordAudit(actor, 'attendance_correction.requested', 'AttendanceCorrection', c._id, null, c.toObject());
  return c;
}

export async function listCorrections(actor, { status, page, limit }) {
  const filter = { ...(status ? { status } : {}) };
  if (actor.role === 'employee') filter.employee = (await ownEmployee(actor))._id;
  const [items, total] = await Promise.all([
    AttendanceCorrection.find(filter).populate('employee', 'name employeeCode').sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    AttendanceCorrection.countDocuments(filter),
  ]);
  return { items, meta: { page, limit, total, pages: Math.ceil(total / limit) } };
}

export async function decideCorrection(actor, id, { decision, comment }) {
  const c = await AttendanceCorrection.findById(id);
  if (!c) throw new ApiError(404, 'Correction not found');
  const emp = await Employee.findById(c.employee).populate('user', 'role');
  if (String(emp.user._id) === String(actor._id)) throw new ApiError(403, 'You cannot decide your own request');
  assertScope(actor, emp);
  if (c.status !== 'pending') throw new ApiError(409, `Already ${c.status}`);
  const company = await getCompany();
  const before = c.toObject();
  if (decision === 'approved') {
    let rec = await Attendance.findOne({ employee: emp._id, date: c.date });
    const checkIn = c.checkIn ? zonedToUtc(c.date, c.checkIn, company.timezone) : rec?.checkIn;
    const checkOut = c.checkOut ? zonedToUtc(c.date, c.checkOut, company.timezone) : rec?.checkOut;
    if (!checkIn) throw new ApiError(422, 'This correction has no check-in time and no record exists to amend');
    if (checkOut && checkOut <= checkIn) throw new ApiError(422, 'Resulting check-out is not after check-in');
    const late = isLate(localParts(checkIn, company.timezone).secs, company.officeStart, company.graceMinutes);
    const worked = checkOut ? minutesBetween(checkIn, checkOut) : 0;
    const status = checkOut ? finalStatus({ late, workedMinutes: worked, halfDayHours: company.rules.halfDayHours }) : c.date < (await todayKey(company)) ? 'missing_checkout' : late ? 'late' : 'present';
    rec = rec || new Attendance({ employee: emp._id, date: c.date });
    Object.assign(rec, { checkIn, checkOut, isLate: late, workedMinutes: worked, status, source: 'correction' });
    await rec.save();
  }
  Object.assign(c, { status: decision, decidedBy: actor._id, decisionComment: comment, decidedAt: new Date() });
  await c.save();
  await recordAudit(actor, `attendance_correction.${decision}`, 'AttendanceCorrection', c._id, before, c.toObject());
  await notify(emp.user._id, 'attendance_correction', `Attendance correction ${decision}`, `${c.date}: ${comment || 'No comment'}`, '/attendance');
  return c;
}
