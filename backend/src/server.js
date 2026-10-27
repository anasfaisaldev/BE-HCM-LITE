import { env } from './config/env.js';
import { connectDb } from './config/db.js';
import { createApp } from './app.js';
import { Company } from './models/Company.js';
import { ensureDefaultLeaveTypes } from './services/orgService.js';
import { bootstrapFromEnv } from './services/setupService.js';

await connectDb();
await bootstrapFromEnv(env);
if (await Company.exists({})) await ensureDefaultLeaveTypes(); // also upgrades Phase 1 databases
createApp().listen(env.port, () => console.log(`[api] listening on :${env.port}`));
