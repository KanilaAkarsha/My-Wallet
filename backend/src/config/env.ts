import { z } from 'zod';

const hex32 = z.string().regex(/^[0-9a-fA-F]{64}$/, 'must be 64 hex characters (32 bytes)');

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    APP_ORIGIN: z.string().url().default('http://localhost:5173'),
    API_ORIGIN: z.string().url().default('http://localhost:4000'),
    DEFAULT_CURRENCY: z.string().length(3).default('LKR'),
    DEFAULT_TIMEZONE: z.string().default('Asia/Colombo'),

    MONGODB_URI: z.string().min(1),
    MONGODB_MAX_POOL_SIZE: z.coerce.number().int().min(1).max(200).default(20),
    REDIS_URL: z.string().optional(),

    SESSION_SECRET: hex32,
    FIELD_ENCRYPTION_KEY: hex32,
    FIELD_ENCRYPTION_KEY_ID: z.string().min(1).default('k1'),

    COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
    COOKIE_DOMAIN: z.string().optional(),
    SESSION_IDLE_DAYS: z.coerce.number().int().min(1).default(7),
    SESSION_ABSOLUTE_DAYS: z.coerce.number().int().min(1).default(30),
    REQUIRE_EMAIL_VERIFICATION: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === 'true')),

    SMTP_URL: z.string().optional(),
    EMAIL_FROM: z.string().default('MyWallet <no-reply@mywallet.example>'),
    PAYMENT_PROVIDER: z.string().optional(),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    /** Must match an "Authorized redirect URI" in Google Cloud Console. Defaults to APP_ORIGIN + /api/v1/auth/google/callback. */
    GOOGLE_REDIRECT_URI: z.string().url().optional(),
    REQUEST_TIMEOUT_MS: z.coerce.number().int().min(1000).default(30000),
  })
  .superRefine((v, ctx) => {
    if (v.COOKIE_SAMESITE === 'none' && v.NODE_ENV !== 'production') {
      // 'none' requires Secure, which browsers only honour over HTTPS (localhost excepted).
    }
    if (v.NODE_ENV === 'production') {
      if (!v.APP_ORIGIN.startsWith('https://')) ctx.addIssue({ code: 'custom', path: ['APP_ORIGIN'], message: 'must be https in production' });
      if (/replace-me/.test(v.SESSION_SECRET + v.FIELD_ENCRYPTION_KEY)) ctx.addIssue({ code: 'custom', message: 'placeholder secrets in production' });
      if (!v.REDIS_URL) ctx.addIssue({ code: 'custom', path: ['REDIS_URL'], message: 'required in production' });
    }
  });

export type Env = z.infer<typeof schema> & { requireEmailVerification: boolean; isProd: boolean };

export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const r = schema.safeParse(source);
  if (!r.success) {
    const lines = r.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${lines}`);
  }
  const isProd = r.data.NODE_ENV === 'production';
  return { ...r.data, isProd, requireEmailVerification: r.data.REQUIRE_EMAIL_VERIFICATION ?? isProd };
}

let cached: Env | undefined;
export function env(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
export function resetEnvCache(): void {
  cached = undefined;
}
