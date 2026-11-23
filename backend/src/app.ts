import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { globalLimiter, rejectInjection, requestId, requestTimeout, securityHeaders, strictCors } from './middleware/security.js';
import { accountsRouter } from './modules/accounts/accounts.routes.js';
import { adminRouter } from './modules/admin/admin.routes.js';
import { attachmentsRouter } from './modules/attachments/attachments.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { googleRouter } from './modules/auth/google.routes.js';
import { twoFactorRouter } from './modules/auth/twofactor.routes.js';
import { billingRouter, billingWebhookRouter } from './modules/billing/billing.routes.js';
import { billsRouter } from './modules/bills/bills.routes.js';
import { budgetsRouter } from './modules/budgets/budgets.routes.js';
import { categoriesRouter } from './modules/categories/categories.routes.js';
import { dashboardRouter } from './modules/dashboard/dashboard.routes.js';
import { debtsRouter } from './modules/debts/debts.routes.js';
import { goalsRouter } from './modules/goals/goals.routes.js';
import { insightsRouter } from './modules/insights/insights.routes.js';
import { notificationsRouter } from './modules/notifications/notifications.routes.js';
import { plannerRouter } from './modules/planner/planner.routes.js';
import { profileRouter } from './modules/profile/profile.routes.js';
import { recurringRouter } from './modules/recurring/recurring.routes.js';
import { reportsRouter } from './modules/reports/reports.routes.js';
import { subscriptionsRouter } from './modules/subscriptions/subscriptions.routes.js';
import { transactionsRouter } from './modules/transactions/transactions.routes.js';
import { transfersRouter } from './modules/transfers/transfers.routes.js';
import { buildOpenApi } from './openapi.js';
import { bumpVersion } from './shared/cache.js';
import { logger } from './shared/logger.js';

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env().isProd ? 1 : false); // behind Render/Vercel proxy in production

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => String((req as express.Request).id),
      // Log method/path/status only. Never bodies, query strings or headers.
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: String(req.url).split('?')[0] }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use(securityHeaders());
  app.use(strictCors());
  app.use(requestTimeout());
  app.use(globalLimiter());

  // Webhook needs the RAW body for signature verification, so it is mounted before express.json().
  app.use('/api/v1/billing/webhook', billingWebhookRouter);

  app.use(express.json({ limit: '100kb', strict: true }));
  app.use(cookieParser());
  app.use(rejectInjection);

  // Any successful write invalidates that user's derived-view cache (balances are never cached anyway).
  app.use('/api/v1', (req, res, next) => {
    res.on('finish', () => {
      if (req.auth && !['GET', 'HEAD', 'OPTIONS'].includes(req.method) && res.statusCode < 400) void bumpVersion(req.auth.userId);
    });
    next();
  });

  app.get('/health', (_req, res) => void res.json({ status: 'ok' }));

  if (!env().isProd || process.env.ENABLE_API_DOCS === 'true') {
    const spec = buildOpenApi();
    app.get('/api/v1/openapi.json', (_req, res) => void res.json(spec));
    // The docs UI needs inline scripts/styles, so it carries its own relaxed CSP and is off in production by default.
    app.use('/api/v1/docs', (_req: Request, res: Response, next: NextFunction) => { res.removeHeader('Content-Security-Policy'); next(); }, swaggerUi.serve, swaggerUi.setup(spec));
  }

  const v1 = '/api/v1';
  app.use(`${v1}/auth/2fa`, twoFactorRouter);
  app.use(`${v1}/auth`, googleRouter);
  app.use(`${v1}/auth`, authRouter);
  app.use(`${v1}/profile`, profileRouter);
  app.use(`${v1}/planner`, plannerRouter);
  app.use(`${v1}/accounts`, accountsRouter);
  app.use(`${v1}/categories`, categoriesRouter);
  app.use(`${v1}/transactions`, transactionsRouter);
  app.use(`${v1}/transfers`, transfersRouter);
  app.use(`${v1}/budgets`, budgetsRouter);
  app.use(`${v1}/goals`, goalsRouter);
  app.use(`${v1}/debts`, debtsRouter);
  app.use(`${v1}/bills`, billsRouter);
  app.use(`${v1}/recurring`, recurringRouter);
  app.use(`${v1}/subscriptions`, subscriptionsRouter);
  app.use(`${v1}/notifications`, notificationsRouter);
  app.use(`${v1}/dashboard`, dashboardRouter);
  app.use(`${v1}/reports`, reportsRouter);
  app.use(`${v1}/insights`, insightsRouter);
  app.use(`${v1}/attachments`, attachmentsRouter);
  app.use(`${v1}/billing`, billingRouter);
  app.use(`${v1}/admin`, adminRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
