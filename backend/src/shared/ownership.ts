/**
 * Centralised ownership enforcement. Every repository read/write goes through these helpers so
 * that `userId` from the authenticated session is part of every query. There is deliberately no
 * helper that fetches by id alone.
 */
import { isValidObjectId, type FilterQuery, type HydratedDocument, type Model, type Types } from 'mongoose';
import { notFound } from './errors.js';

export const assertObjectId = (id: unknown, what = 'Resource'): string => {
  if (typeof id !== 'string' || !isValidObjectId(id) || id.length !== 24) throw notFound(what);
  return id;
};

/** Scope any filter to the owner. Caller-provided `userId` keys are overwritten, never trusted. */
export function ownedFilter<T>(userId: string, filter: FilterQuery<T> = {}): FilterQuery<T> {
  return { ...filter, userId } as FilterQuery<T>;
}

/** 404 (not 403) for other users' records so existence is not revealed. */
export async function findOwned<T>(
  model: Model<T>,
  userId: string,
  id: unknown,
  what = 'Resource',
  extra: FilterQuery<T> = {},
): Promise<any> {
  const oid = assertObjectId(id, what);
  const doc = await model.findOne({ ...extra, _id: oid, userId } as FilterQuery<T>);
  if (!doc) throw notFound(what);
  return doc;
}

/** Verify that every referenced id (e.g. accountId, categoryId in a request) belongs to the user. */
export async function assertAllOwned<T>(model: Model<T>, userId: string, ids: readonly string[], what: string): Promise<void> {
  const unique = [...new Set(ids.map((i) => assertObjectId(i, what)))];
  if (unique.length === 0) return;
  const count = await model.countDocuments({ _id: { $in: unique }, userId } as FilterQuery<T>);
  if (count !== unique.length) throw notFound(what);
}

export type OwnerId = Types.ObjectId | string;
