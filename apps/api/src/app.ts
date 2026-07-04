import compression from 'compression';
import cors from 'cors';
import express from 'express';
import { config } from './config';
import { errorHandler } from './middleware/error';
import accountsRouter from './routes/accounts';
import authRouter from './routes/auth';
import budgetsRouter from './routes/budgets';
import categoriesRouter from './routes/categories';
import dashboardRouter from './routes/dashboard';
import debtsRouter from './routes/debts';
import goalsRouter from './routes/goals';
import notificationsRouter from './routes/notifications';
import recurringRouter from './routes/recurring';
import reportsRouter from './routes/reports';
import rulesRouter from './routes/rules';
import transactionsRouter from './routes/transactions';
import transfersRouter from './routes/transfers';

export function createApp() {
  const app = express();
  app.use(compression());
  app.use(cors({ origin: config.corsOrigin }));
  // Límite amplio para soportar recibos en base64 (~2 MB) e importación de CSV.
  app.use(express.json({ limit: '5mb' }));

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

  app.use('/api/auth', authRouter);
  app.use('/api/accounts', accountsRouter);
  app.use('/api/categories', categoriesRouter);
  app.use('/api/rules', rulesRouter);
  app.use('/api/transactions', transactionsRouter);
  app.use('/api/transfers', transfersRouter);
  app.use('/api/recurring', recurringRouter);
  app.use('/api/budgets', budgetsRouter);
  app.use('/api/debts', debtsRouter);
  app.use('/api/goals', goalsRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/notifications', notificationsRouter);

  app.use(errorHandler);
  return app;
}
