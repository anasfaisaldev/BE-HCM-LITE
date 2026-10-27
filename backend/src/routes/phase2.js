import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler as h } from '../utils/asyncHandler.js';
import { ok } from '../utils/respond.js';
import * as V from '../validators/index.js';
import * as org from '../services/orgService.js';
import * as att from '../services/attendanceService.js';
import * as leave from '../services/leaveService.js';
import * as notif from '../services/notificationService.js';

const router = Router();
router.use(authenticate());
const staff = authorize('admin', 'hr');

// Organization extras (Admin writes; everyone reads via GET /org)
router.post('/org/holidays', authorize('admin'), validate(V.holidaySchema), h(async (req, res) => ok(res, await org.createHoliday(req.user, req.body), undefined, 201)));
router.delete('/org/holidays/:id', authorize('admin'), validate(V.idParam, 'params'), h(async (req, res) => { await org.deleteHoliday(req.user, req.params.id); ok(res, { deleted: true }); }));
router.post('/org/leave-types', authorize('admin'), validate(V.leaveTypeCreateSchema), h(async (req, res) => ok(res, await org.createLeaveType(req.user, req.body), undefined, 201)));
router.patch('/org/leave-types/:id', authorize('admin'), validate(V.idParam, 'params'), validate(V.leaveTypeUpdateSchema), h(async (req, res) => ok(res, await org.updateLeaveType(req.user, req.params.id, req.body))));

// Attendance
router.get('/attendance/today', h(async (req, res) => ok(res, await att.today(req.user))));
router.post('/attendance/check-in', validate(V.verificationSchema), h(async (req, res) => ok(res, await att.checkIn(req.user, req.body.verification), undefined, 201)));
router.post('/attendance/check-out', validate(V.verificationSchema), h(async (req, res) => ok(res, await att.checkOut(req.user, req.body.verification))));
router.get('/attendance/calendar', validate(V.calendarQuery, 'query'), h(async (req, res) => ok(res, await att.calendar(req.user, req.query))));
router.get('/attendance/board', staff, validate(V.boardQuery, 'query'), h(async (req, res) => ok(res, await att.dailyBoard(req.user, req.query))));
router.post('/attendance/corrections', validate(V.correctionSchema), h(async (req, res) => ok(res, await att.requestCorrection(req.user, req.body), undefined, 201)));
router.get('/attendance/corrections', validate(V.requestListQuery, 'query'), h(async (req, res) => { const r = await att.listCorrections(req.user, req.query); ok(res, r.items, r.meta); }));
router.patch('/attendance/corrections/:id', staff, validate(V.idParam, 'params'), validate(V.decisionSchema), h(async (req, res) => ok(res, await att.decideCorrection(req.user, req.params.id, req.body))));

// Leave
router.get('/leave/balance', validate(V.balanceQuery, 'query'), h(async (req, res) => ok(res, await leave.getBalances(req.user, req.query))));
router.get('/leave/requests', validate(V.requestListQuery, 'query'), h(async (req, res) => { const r = await leave.listLeave(req.user, req.query); ok(res, r.items, r.meta); }));
router.post('/leave/requests', validate(V.leaveApplySchema), h(async (req, res) => ok(res, await leave.applyLeave(req.user, req.body), undefined, 201)));
router.post('/leave/requests/:id/cancel', validate(V.idParam, 'params'), h(async (req, res) => ok(res, await leave.cancelLeave(req.user, req.params.id))));
router.patch('/leave/requests/:id/decision', staff, validate(V.idParam, 'params'), validate(V.decisionSchema), h(async (req, res) => ok(res, await leave.decideLeave(req.user, req.params.id, req.body))));

// Notifications (own only)
router.get('/notifications', h(async (req, res) => { const r = await notif.listNotifications(req.user); ok(res, r.items, { unread: r.unread }); }));
router.post('/notifications/read-all', h(async (req, res) => { await notif.markAllRead(req.user); ok(res, { done: true }); }));
router.patch('/notifications/:id/read', validate(V.idParam, 'params'), h(async (req, res) => { await notif.markRead(req.user, req.params.id); ok(res, { done: true }); }));

export default router;
