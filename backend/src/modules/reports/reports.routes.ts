import { Router } from 'express';
import { z } from 'zod';
import { authed, requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { userProfile } from '../../services/ledger.service.js';
import { badRequest } from '../../shared/errors.js';
import { h } from '../../shared/http.js';
import { zonedMidnight, zonedParts } from '../../shared/http.js';
import { effectivePlan } from '../billing/limits.js';
import { csvCell, toCsv, toPdf } from './export.js';
import { ADVANCED, REPORT_NAMES, buildReport, transactionCsvRows, type ReportName } from './reports.service.js';

const q = z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional(), format: z.enum(['json', 'csv', 'pdf']).default('json') });

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

reportsRouter.get('/', h(async (req, res) => {
  const plan = await effectivePlan(authed(req).userId);
  res.json({ reports: REPORT_NAMES.map((name) => ({ name, advanced: ADVANCED.has(name), available: !ADVANCED.has(name) || plan.features.includes('reports.advanced') })), historyWindowMonths: plan.limits.reportMonths, plan: plan.code });
}));

/** Full-history CSV, streamed page by page (memory-safe for large ledgers). Basic CSV is available on every plan. */
reportsRouter.get('/transactions.csv', h(async (req, res) => {
  const { userId } = authed(req);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="mywallet-transactions.csv"');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.write('﻿');
  for await (const row of transactionCsvRows(userId)) res.write(row.map(csvCell).join(',') + '\r\n');
  res.end();
}));

reportsRouter.get('/:name', validate({ query: q }), h(async (req, res) => {
  const { userId } = authed(req);
  const name = req.params.name as ReportName;
  if (!REPORT_NAMES.includes(name)) throw badRequest('Unknown report');
  const query = req.query as unknown as z.infer<typeof q>;
  const plan = await effectivePlan(userId);
  if (ADVANCED.has(name) && !plan.features.includes('reports.advanced')) return void res.status(402).json({ error: { code: 'PLAN_LIMIT', message: 'This report needs a higher plan', requestId: req.id } });
  if (query.format === 'pdf' && !plan.features.includes('reports.advanced')) return void res.status(402).json({ error: { code: 'PLAN_LIMIT', message: 'PDF export needs a higher plan', requestId: req.id } });

  const { timezone: tz } = await userProfile(userId);
  const now = new Date();
  const p = zonedParts(now, tz);
  // The plan limits how far back reports LOOK; stored history is never deleted or hidden elsewhere.
  const windowMonths = plan.limits.reportMonths ?? 3;
  const earliest = zonedMidnight(p.y, p.m - windowMonths + 1, 1, tz);
  let from = query.from ?? zonedMidnight(p.y, p.m - 11, 1, tz);
  const to = query.to ?? zonedMidnight(p.y, p.m + 1, 1, tz);
  if (to <= from) throw badRequest('from must be before to');
  const limited = from < earliest;
  if (limited) from = earliest;
  const table = await buildReport(userId, name, { from, to });
  if (query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="mywallet-${name}.csv"`);
    return void res.send(toCsv(table));
  }
  if (query.format === 'pdf') {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="mywallet-${name}.pdf"`);
    return void res.send(await toPdf(table));
  }
  res.json({ ...table, window: { from, to, limitedByPlan: limited, planMonths: windowMonths } });
}));
