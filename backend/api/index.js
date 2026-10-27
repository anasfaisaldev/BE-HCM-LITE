let app;
let ready;

async function init() {
  const { env } = await import('../src/config/env.js');
  const { connectDb } = await import('../src/config/db.js');
  const { createApp } = await import('../src/app.js');
  const { Company } = await import('../src/models/Company.js');
  const { ensureDefaultLeaveTypes } = await import('../src/services/orgService.js');
  const { bootstrapFromEnv } = await import('../src/services/setupService.js');

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
    res.status(500).json({ error: 'init failed', message: err.message, stack: err.stack?.split('\n').slice(0, 5) });
  }
}