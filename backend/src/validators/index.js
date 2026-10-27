import { z } from 'zod';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((s) => !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().startsWith(s), 'Invalid date');
const name = z.string().trim().min(2).max(100);
const email = z.string().trim().toLowerCase().email('Invalid email');
export const passwordRule = z
  .string()
  .min(8, 'At least 8 characters')
  .max(72)
  .regex(/[A-Za-z]/, 'Must contain a letter')
  .regex(/\d/, 'Must contain a number');

export const setupSchema = z.object({
  companyName: z.string().trim().min(2).max(120),
  name,
  email,
  password: passwordRule,
});
export const loginSchema = z.object({ email, password: z.string().min(1).max(72) });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(72), newPassword: passwordRule });

export const orgSettingsSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    officeStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM'),
    graceMinutes: z.number().int().min(0).max(120),
    weekend: z.array(z.number().int().min(0).max(6)).max(6),
    requireCameraCheckIn: z.boolean(),
    geo: z.object({
      lat: z.number().min(-90).max(90).nullable(),
      lng: z.number().min(-180).max(180).nullable(),
      radiusMeters: z.number().min(10).max(5000),
    }).partial(),
  })
  .partial();
export const departmentSchema = z.object({ name: z.string().trim().min(2).max(80) });
export const designationSchema = z.object({ title: z.string().trim().min(2).max(80) });

const status = z.enum(['active', 'probation', 'resigned', 'terminated']);
export const employeeCreateSchema = z.object({
  employeeCode: z.string().trim().min(2).max(20).regex(/^[A-Za-z0-9-_]+$/, 'Letters, numbers, - and _ only'),
  name,
  email,
  phone: z.string().trim().max(30).optional(),
  gender: z.enum(['male', 'female', 'other']).optional(),
  department: objectId,
  designation: objectId,
  joiningDate: isoDate,
  status: status.default('active'),
  basicSalary: z.number().positive('Salary must be greater than zero'),
  role: z.enum(['employee', 'hr', 'admin']).default('employee'),
});
export const employeeUpdateSchema = z
  .object({
    name,
    phone: z.string().trim().max(30),
    address: z.string().trim().max(300),
    gender: z.enum(['male', 'female', 'other']),
    department: objectId,
    designation: objectId,
    status,
    leavingDate: isoDate,
    basicSalary: z.number().positive('Salary must be greater than zero'),
  })
  .partial();
export const selfUpdateSchema = z.object({ phone: z.string().trim().max(30), address: z.string().trim().max(300) }).partial().strict();

export const employeeListQuery = z.object({
  search: z.string().trim().max(60).optional(),
  department: objectId.optional(),
  designation: objectId.optional(),
  status: status.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export const auditQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  action: z.string().trim().max(60).optional(),
});
export const idParam = z.object({ id: objectId });

// ---- Phase 2
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
const pageQ = { page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) };
export const holidaySchema = z.object({ date: isoDate, name: z.string().trim().min(2).max(100) });
export const leaveTypeCreateSchema = z.object({
  name: z.string().trim().min(2).max(60),
  code: z.string().trim().toLowerCase().regex(/^[a-z0-9_-]{2,20}$/, 'Lowercase letters, numbers, - or _'),
  annualQuota: z.number().min(0).nullable(),
  isPaid: z.boolean().default(true),
});
export const leaveTypeUpdateSchema = z.object({ annualQuota: z.number().min(0).nullable(), isPaid: z.boolean() }).partial();
export const correctionSchema = z.object({ date: isoDate, checkIn: hhmm.optional(), checkOut: hhmm.optional(), reason: z.string().trim().min(5, 'Give a short reason').max(500) });
export const decisionSchema = z.object({ decision: z.enum(['approved', 'rejected']), comment: z.string().trim().max(500).optional() });
export const calendarQuery = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM'), employeeId: objectId.optional() });
export const boardQuery = z.object({ date: isoDate.optional(), department: objectId.optional() });
export const requestListQuery = z.object({ status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(), ...pageQ });
export const leaveApplySchema = z.object({ leaveType: objectId, startDate: isoDate, endDate: isoDate, reason: z.string().trim().max(500).optional() });
export const balanceQuery = z.object({ employeeId: objectId.optional(), year: z.coerce.number().int().min(2000).max(2100).optional() });

// ---- Phase 3
export const payrollGenerateSchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM') });
export const payrollRunQuery = z.object({ search: z.string().trim().max(60).optional(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(25) });

// ---- Phase 4
export const dashboardQuery = z.object({ from: isoDate.optional(), to: isoDate.optional(), department: objectId.optional() });
export const announcementSchema = z.object({ title: z.string().trim().min(3).max(120), body: z.string().trim().min(3).max(2000), expiresAt: isoDate.optional() });
export const chatSchema = z.object({
  message: z.string().trim().min(1).max(1000),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(2000) })).max(10).default([]),
});
export const leaveParseBody = z.object({ text: z.string().trim().min(3).max(500) });

// ---- Phase 5
export const importSchema = z.object({ csv: z.string().min(1).max(1_500_000), dryRun: z.boolean().default(true) });
export const verificationSchema = z.object({
  verification: z.object({
    faceCount: z.number().int().min(0).max(20),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracy: z.number().min(0).max(100000),
  }).optional(),
});
