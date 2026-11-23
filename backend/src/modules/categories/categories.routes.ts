import { Router } from 'express';
import { z } from 'zod';
import { Category } from '../../database/models/index.js';
import { authed, requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { badRequest, conflict, forbidden } from '../../shared/errors.js';
import { h, idParams } from '../../shared/http.js';
import { findOwned } from '../../shared/ownership.js';

const dto = (c: any) => ({ id: String(c._id), name: c.name, kind: c.kind, isSystem: !!c.isSystem, icon: c.icon ?? null, color: c.color ?? null });
const create = z.object({ name: z.string().trim().min(1).max(60), kind: z.enum(['income', 'expense']), icon: z.string().max(40).optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional() }).strict();
const patch = z.object({ name: z.string().trim().min(1).max(60), icon: z.string().max(40).nullable(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable() }).partial().strict();

export const categoriesRouter = Router();
categoriesRouter.use(requireAuth);

categoriesRouter.get('/', h(async (req, res) => {
  const { userId } = authed(req);
  const rows: any[] = await Category.find({ $or: [{ userId: null }, { userId }], archivedAt: null }).sort({ kind: 1, name: 1 }).lean();
  res.json({ categories: rows.map(dto) });
}));

categoriesRouter.post('/', validate({ body: create }), h(async (req, res) => {
  const { userId } = authed(req);
  const sys = await Category.findOne({ userId: null, kind: req.body.kind, name: new RegExp(`^${req.body.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).lean();
  if (sys) throw conflict('A default category with this name already exists');
  try {
    res.status(201).json(dto(await Category.create({ ...req.body, userId, isSystem: false })));
  } catch (e) {
    if ((e as { code?: number }).code === 11000) throw conflict('You already have this category');
    throw e;
  }
}));

categoriesRouter.patch('/:id', validate({ params: idParams, body: patch }), h(async (req, res) => {
  const { userId } = authed(req);
  const c = await findOwned(Category, userId, req.params.id, 'Category', { archivedAt: null }); // system rows have userId=null -> not found
  Object.assign(c, req.body);
  await c.save();
  res.json(dto(c));
}));

/** Archive (not delete) so past transactions keep their category. */
categoriesRouter.delete('/:id', validate({ params: idParams }), h(async (req, res) => {
  const { userId } = authed(req);
  const sys = await Category.findOne({ _id: req.params.id, userId: null }).lean();
  if (sys) throw forbidden('Default categories cannot be removed');
  const c = await findOwned(Category, userId, req.params.id, 'Category', { archivedAt: null });
  if (!c) throw badRequest('Category not found');
  c.archivedAt = new Date();
  await c.save();
  res.status(204).end();
}));
