import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler as h } from '../utils/asyncHandler.js';
import { ok } from '../utils/respond.js';
import * as V from '../validators/index.js';
import * as pay from '../services/payrollService.js';
import { streamPayslipPdf } from '../services/pdfService.js';
import { getCompany } from '../services/context.js';

const router = Router();
router.use(authenticate());
const staff = authorize('admin', 'hr');

router.get('/payroll/runs', staff, h(async (_req, res) => ok(res, await pay.listRuns())));
router.post('/payroll/runs', staff, validate(V.payrollGenerateSchema), h(async (req, res) => ok(res, await pay.generateDraft(req.user, req.body), undefined, 201)));
router.get('/payroll/runs/:id', staff, validate(V.idParam, 'params'), validate(V.payrollRunQuery, 'query'), h(async (req, res) => {
  const r = await pay.getRun(req.user, req.params.id, req.query);
  ok(res, { run: r.run, items: r.items }, r.meta);
}));
router.post('/payroll/runs/:id/finalize', authorize('admin'), validate(V.idParam, 'params'), h(async (req, res) => ok(res, await pay.finalizeRun(req.user, req.params.id))));

router.get('/payslips', h(async (req, res) => ok(res, await pay.listOwnPayslips(req.user))));
router.get('/payslips/:id', validate(V.idParam, 'params'), h(async (req, res) => ok(res, await pay.getPayslip(req.user, req.params.id))));
router.get('/payslips/:id/pdf', validate(V.idParam, 'params'), h(async (req, res) => {
  const slip = await pay.getPayslip(req.user, req.params.id);
  streamPayslipPdf(res, slip, (await getCompany()).name);
}));

export default router;
