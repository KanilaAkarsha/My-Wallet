import { Router } from 'express';
import { authed, requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { userProfile } from '../../services/ledger.service.js';
import { rangeQuery, resolveRange } from '../../shared/dateRange.js';
import { h } from '../../shared/http.js';
import { dashboardSummary } from './dashboard.service.js';

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

/** Everything on the dashboard comes from this one backend call; balances are always computed fresh. */
dashboardRouter.get('/', validate({ query: rangeQuery }), h(async (req, res) => {
  const { userId } = authed(req);
  const q = req.query as any;
  const { currency, timezone } = await userProfile(userId);
  const range = resolveRange(q.range, timezone, new Date(), q.from, q.to);
  res.json(await dashboardSummary(userId, range, timezone, currency));
}));
