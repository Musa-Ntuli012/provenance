import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { authRouter } from './modules/auth.routes.js';
import { tenantsRouter } from './modules/tenants.routes.js';
import { usersRouter } from './modules/users.routes.js';
import { clientsRouter } from './modules/clients.routes.js';
import { projectsRouter } from './modules/projects.routes.js';
import { financeRouter } from './modules/finance.routes.js';
import { documentsRouter } from './modules/documents.routes.js';
import { tasksRouter } from './modules/tasks.routes.js';
import { dashboardRouter } from './modules/dashboard.routes.js';
import { auditRouter } from './modules/audit.routes.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  // Same-origin through the Vite/dev proxy in development; the allow-list
  // matters only when the API is called cross-origin (e.g. split deploy).
  if (config.corsOrigins.length > 0) {
    app.use(cors({ origin: config.corsOrigins, credentials: true }));
  }

  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 300,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: (req) => req.path === '/health',
  });
  app.use('/api', apiLimiter);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'provenance-api', time: new Date().toISOString() });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/tenant', tenantsRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/clients', clientsRouter);
  app.use('/api/projects', projectsRouter);
  app.use('/api/finance', financeRouter);
  app.use('/api/documents', documentsRouter);
  app.use('/api/tasks', tasksRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/audit', auditRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
