import { Router } from 'express';
import { FinancialInsight } from '../../database/models/index.js';
import { authed, requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { h, idParams } from '../../shared/http.js';
import { findOwned } from '../../shared/ownership.js';
import { requireFeature } from '../billing/limits.js';
import { computeInsights } from './insights.service.js';

const dto = (i: any) => ({ id: String(i._id), ruleId: i.ruleId, severity: i.severity, headline: i.headline, what: i.what, period: i.period, calculation: i.calculation, why: i.why, createdAt: i.createdAt });

export const insightsRouter = Router();
insightsRouter.use(requireAuth, requireFeature('insights'));

insightsRouter.get('/', h(async (req, res) => {
  const { userId } = authed(req);
  const rows: any[] = await FinancialInsight.find({ userId, dismissedAt: null }).sort({ createdAt: -1 }).limit(50).lean();
  res.json({ insights: rows.map(dto) });
}));

insightsRouter.post('/refresh', h(async (req, res) => {
  const { userId } = authed(req);
  res.json({ created: await computeInsights(userId) });
}));

insightsRouter.post('/:id/dismiss', validate({ params: idParams }), h(async (req, res) => {
  const { userId } = authed(req);
  const i = await findOwned(FinancialInsight, userId, req.params.id, 'Insight');
  i.dismissedAt = new Date();
  await i.save();
  res.status(204).end();
}));
