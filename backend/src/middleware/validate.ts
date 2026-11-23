import type { RequestHandler } from 'express';
import type { ZodTypeAny, z } from 'zod';
import { badRequest } from '../shared/errors.js';

type Schemas = { body?: ZodTypeAny; query?: ZodTypeAny; params?: ZodTypeAny };

/** Validates with Zod and REPLACES the raw input with the parsed (stripped, typed) value. */
export const validate =
  (schemas: Schemas): RequestHandler =>
  (req, _res, next) => {
    for (const part of ['params', 'query', 'body'] as const) {
      const schema = schemas[part];
      if (!schema) continue;
      const r = schema.safeParse(req[part]);
      if (!r.success) {
        return next(
          badRequest(
            'Validation failed',
            r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
          ),
        );
      }
      if (part === 'query') Object.defineProperty(req, 'query', { value: r.data, writable: true, configurable: true });
      else (req as unknown as Record<string, unknown>)[part] = r.data;
    }
    next();
  };

export type Infer<T extends ZodTypeAny> = z.infer<T>;
