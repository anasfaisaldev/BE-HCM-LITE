import { env } from '../src/config/env.js';
import { connectDb } from '../src/config/db.js';
import { createApp } from '../src/app.js';
import { Company } from '../src/models/Company.js';
import { ensureDefaultLeaveTypes } from '../src/services/orgService.js';
import { bootstrapFromEnv } from '../src/services/setupService.js';

let app;
let ready;

async function init() {
  await connectDb();
  await bootstrapFromEnv(env);
  if (await Company.exists({})) await ensureDefaultLeaveTypes();
  app = createApp();
}

export default async function handler(req, res) {
  try {
    ready ??= init();
    await ready;
    return app(req, res);
  } catch (err) {
    ready = undefined;
    console.error('[init failed]', err);
    res.status(500).json({ error: 'init failed', message: err.message });
  }
}