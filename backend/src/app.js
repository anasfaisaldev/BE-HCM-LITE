import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import { env } from './config/env.js';
import routes from './routes/index.js';
import { errorHandler, notFound } from './middleware/error.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: env.clientOrigin, credentials: true }));
  app.use('/api/employees/import', express.json({ limit: '2mb' }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  if (env.nodeEnv !== 'test') app.use(morgan('tiny'));
  app.get('/', (_req, res) => res.json({ success: true, message: 'HCM Lite API is running' }));
  app.use('/api', routes);
  if (env.serveFrontend && fs.existsSync(env.serveFrontend)) {
    app.use(express.static(env.serveFrontend)); // single-origin deploy: cookies work with no CORS/proxy setup
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.resolve(env.serveFrontend, 'index.html')));
  }
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
