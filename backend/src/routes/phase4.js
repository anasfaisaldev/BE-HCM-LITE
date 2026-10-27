import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler as h } from '../utils/asyncHandler.js';
import { ok } from '../utils/respond.js';
import * as V from '../validators/index.js';
import * as dash from '../services/dashboardService.js';
import * as ann from '../services/announcementService.js';
import * as ai from '../ai/aiService.js';

const router = Router();
router.use(authenticate());
const staff = authorize('admin', 'hr');

router.get('/dashboard', validate(V.dashboardQuery, 'query'), h(async (req, res) => ok(res, await dash.getDashboard(req.user, req.query))));

router.get('/announcements', h(async (_req, res) => ok(res, await ann.listAnnouncements())));
router.post('/announcements', staff, validate(V.announcementSchema), h(async (req, res) => ok(res, await ann.createAnnouncement(req.user, req.body), undefined, 201)));
router.delete('/announcements/:id', staff, validate(V.idParam, 'params'), h(async (req, res) => { await ann.archiveAnnouncement(req.user, req.params.id); ok(res, { archived: true }); }));

// AI: key stays on the server; every route is role-scoped and rate-limited (20/user/hour) inside the service.
router.post('/ai/chat', validate(V.chatSchema), h(async (req, res) => ok(res, await ai.chat(req.user, req.body))));
router.post('/ai/dashboard-summary', validate(V.dashboardQuery), h(async (req, res) => ok(res, await ai.dashboardSummary(req.user, req.body))));
router.post('/ai/leave-parse', validate(V.leaveParseBody), h(async (req, res) => ok(res, await ai.parseLeave(req.user, req.body))));

export default router;
