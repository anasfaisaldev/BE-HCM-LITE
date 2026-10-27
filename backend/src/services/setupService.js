import { Company } from '../models/Company.js';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { hashPassword } from '../utils/password.js';
import { ensureDefaultLeaveTypes } from './orgService.js';
import { recordAudit } from './auditService.js';

export const needsSetup = async () => !(await Company.exists({}));

export async function runFirstSetup({ companyName, name, email, password }, { mustChangePassword = false } = {}) {
  if (!(await needsSetup())) throw new ApiError(409, 'Setup is already complete');
  let company;
  try {
    company = await Company.create({ name: companyName });
    await ensureDefaultLeaveTypes(); // unique `key` blocks concurrent double-setup
  } catch (e) {
    if (e.code === 11000) throw new ApiError(409, 'Setup is already complete');
    throw e;
  }
  try {
    const admin = await User.create({ name, email, role: 'admin', passwordHash: await hashPassword(password), mustChangePassword });
    await recordAudit(admin, 'setup.completed', 'Company', company._id, null, { company: companyName, admin: email });
    return { company, admin };
  } catch (e) {
    await Company.deleteOne({ _id: company._id }); // roll back so setup can be retried
    throw e;
  }
}

// Optional: bootstrap from ADMIN_EMAIL / ADMIN_PASSWORD env vars on a fresh database.
export async function bootstrapFromEnv(env) {
  if (!env.adminEmail || !env.adminPassword || !(await needsSetup())) return;
  await runFirstSetup(
    { companyName: 'My Company', name: 'Administrator', email: env.adminEmail.toLowerCase(), password: env.adminPassword },
    { mustChangePassword: true }
  );
  console.log('[setup] first Admin created from environment variables');
}
