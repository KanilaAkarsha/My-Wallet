import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import { formatMajor, parseMajor, MoneyError } from '../services/finance/money.js';
import { badRequest } from './errors.js';

/** Async route wrapper: forwards rejections to the error handler. */
export const h =
  (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

export const objectId = z.string().regex(/^[0-9a-f]{24}$/i, 'invalid id');
export const idParams = z.object({ id: objectId }).strict();
export const currencyCode = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/);
/** Decimal string, e.g. "1250.50". Precision is enforced against the currency later. */
export const decimal = z.string().trim().regex(/^\d{1,15}(\.\d{1,3})?$/, 'Amount must be a positive decimal string');
export const signedDecimal = z.string().trim().regex(/^-?\d{1,15}(\.\d{1,3})?$/);
export const isoDate = z.coerce.date();

export function toMinor(value: string, currency: string): bigint {
  try {
    return parseMajor(value, currency);
  } catch (e) {
    if (e instanceof MoneyError) throw badRequest(e.message);
    throw e;
  }
}
export const money = (minor: bigint | null | undefined, currency: string): string | null =>
  minor === null || minor === undefined ? null : formatMajor(BigInt(minor), currency);

/** Express JSON cannot serialise BigInt; deep-convert to strings as a safety net. */
export function jsonSafe<T>(v: T): unknown {
  return JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)));
}

export const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(300).optional(),
});

export function encodeCursor(date: Date, id: unknown): string {
  return Buffer.from(JSON.stringify({ d: date.toISOString(), i: String(id) })).toString('base64url');
}
export function decodeCursor(c?: string): { d: Date; i: string } | undefined {
  if (!c) return undefined;
  try {
    const o = JSON.parse(Buffer.from(c, 'base64url').toString('utf8')) as { d: string; i: string };
    const d = new Date(o.d);
    if (Number.isNaN(d.getTime()) || !/^[0-9a-f]{24}$/i.test(o.i)) throw new Error('bad');
    return { d, i: o.i };
  } catch {
    throw badRequest('Invalid cursor');
  }
}

export const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Date helpers in the user's timezone. Day boundaries use Intl; no external dependency. */
export function zonedParts(date: Date, tz: string) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year!, m: +p.month!, d: +p.day!, hh: +p.hour!, mm: +p.minute!, ss: +p.second! };
}
/** UTC instant of local midnight for the given y-m-d in tz. */
export function zonedMidnight(y: number, m: number, d: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d);
  const p = zonedParts(new Date(guess), tz);
  const asLocal = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
  return new Date(guess - (asLocal - guess));
}
