import cors from 'cors';
import express from 'express';
import { config } from './config';
import { errorHandler } from './middleware/error';
import authRouter from './routes/auth';
import budgetsRouter from './routes/budgets';
import categoriesRouter from './routes/categories';
import dashboardRouter from './routes/dashboard';
import notificationsRouter from './routes/notifications';
import recurringRouter from './routes/recurring';
import reportsRouter from './routes/reports';
import transactionsRouter from './routes/transactions';

export function createApp() {
  const app = express();
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json());

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

  app.use('/api/auth', authRouter);
  app.use('/api/categories', categoriesRouter);
  app.use('/api/transactions', transactionsRouter);
  app.use('/api/recurring', recurringRouter);
  app.use('/api/budgets', budgetsRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/notifications', notificationsRouter);

  app.use(errorHandler);
  return app;
}
