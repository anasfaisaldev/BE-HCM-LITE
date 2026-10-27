import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate, authorize, signToken, cookieOptions, COOKIE_NAME } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ok } from '../utils/respond.js';
import * as V from '../validators/index.js';
import * as setupSvc from '../services/setupService.js';
import * as authSvc from '../services/authService.js';
import * as orgSvc from '../services/orgService.js';
import * as empSvc from '../services/employeeService.js';
import phase2 from './phase2.js';
import payroll from './payroll.js';
import phase4 from './phase4.js';
import * as importSvc from '../services/importService.js';
import * as auditSvc from '../services/auditService.js';

const limiter = (max, windowMs = 15 * 60 * 1000) => rateLimit({ windowMs, max, standardHeaders: true, legacyHeaders: false, skipSuccessfulRequests: true, message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again later.' } } });
const strict = process.env.NODE_ENV === 'test' ? 10000 : 10;

const router = Router();
router.get('/health', (_req, res) => ok(res, { status: 'up' }));

// --- Setup (public, works only on a fresh database)
router.get('/setup/status', asyncHandler(async (_q, res) => ok(res, { needsSetup: await setupSvc.needsSetup() })));
router.post('/setup', limiter(strict), validate(V.setupSchema), asyncHandler(async (req, res) => {
  const { admin } = await setupSvc.runFirstSetup(req.body);
  res.cookie(COOKIE_NAME, signToken(admin), cookieOptions());
  ok(res, admin, undefined, 201);
}));

// --- Auth
const auth = Router();
auth.post('/login', limiter(strict), validate(V.loginSchema), asyncHandler(async (req, res) => {
  const user = await authSvc.login(req.body.email, req.body.password);
  res.cookie(COOKIE_NAME, signToken(user), cookieOptions());
  ok(res, user);
}));
auth.post('/logout', (_req, res) => { res.clearCookie(COOKIE_NAME, { path: '/' }); ok(res, { loggedOut: true }); });
auth.get('/me', authenticate(true), (req, res) => ok(res, req.user));
auth.post('/change-password', limiter(strict), authenticate(true), validate(V.changePasswordSchema), asyncHandler(async (req, res) => {
  const user = await authSvc.changePassword(req.user._id, req.body.currentPassword, req.body.newPassword);
  ok(res, user);
}));
router.use('/auth', auth);

// --- Organization (read: any signed-in user; write: Admin only)
const org = Router();
org.use(authenticate());
org.get('/', asyncHandler(async (_q, res) => ok(res, await orgSvc.getOrg())));
org.put('/settings', authorize('admin'), validate(V.orgSettingsSchema), asyncHandler(async (req, res) => ok(res, await orgSvc.updateSettings(req.user, req.body))));
org.post('/departments', authorize('admin'), validate(V.departmentSchema), asyncHandler(async (req, res) => ok(res, await orgSvc.createDepartment(req.user, req.body), undefined, 201)));
org.post('/designations', authorize('admin'), validate(V.designationSchema), asyncHandler(async (req, res) => ok(res, await orgSvc.createDesignation(req.user, req.body), undefined, 201)));
router.use('/org', org);

// --- Employees (static paths BEFORE /:id)
const emp = Router();
emp.use(authenticate());
emp.get('/me', asyncHandler(async (req, res) => ok(res, await empSvc.getOwnEmployee(req.user))));
emp.patch('/me', validate(V.selfUpdateSchema), asyncHandler(async (req, res) => ok(res, await empSvc.updateOwnContact(req.user, req.body))));
emp.get('/export.csv', authorize('admin', 'hr'), validate(V.employeeListQuery.partial(), 'query'), asyncHandler(async (req, res) => {
  const csv = await empSvc.exportEmployeesCsv(req.user, req.query);
  res.type('text/csv').set('Content-Disposition', 'attachment; filename="employees.csv"').send(csv);
}));
emp.get('/', authorize('admin', 'hr'), validate(V.employeeListQuery, 'query'), asyncHandler(async (req, res) => {
  const { items, meta } = await empSvc.listEmployees(req.query);
  ok(res, items, meta);
}));
emp.post('/import', authorize('admin', 'hr'), validate(V.importSchema), asyncHandler(async (req, res) => ok(res, await importSvc.importEmployees(req.user, req.body))));
emp.post('/', authorize('admin', 'hr'), validate(V.employeeCreateSchema), asyncHandler(async (req, res) => ok(res, await empSvc.createEmployee(req.user, req.body), undefined, 201)));
emp.get('/:id', validate(V.idParam, 'params'), asyncHandler(async (req, res) => ok(res, await empSvc.getEmployee(req.user, req.params.id))));
emp.patch('/:id', authorize('admin', 'hr'), validate(V.idParam, 'params'), validate(V.employeeUpdateSchema), asyncHandler(async (req, res) => ok(res, await empSvc.updateEmployee(req.user, req.params.id, req.body))));
router.use('/employees', emp);

// --- Audit log (Admin only)
router.get('/audit', authenticate(), authorize('admin'), validate(V.auditQuery, 'query'), asyncHandler(async (req, res) => {
  const { items, meta } = await auditSvc.listAudit(req.query);
  ok(res, items, meta);
}));

router.use(phase2);
router.use(payroll);
router.use(phase4);

export default router;
