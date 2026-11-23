import pino from 'pino';

/**
 * Structured logs with aggressive redaction. Financial payloads must never be logged:
 * request bodies are not logged at all; these paths are a second line of defence.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.currentPassword',
  '*.newPassword',
  '*.token',
  '*.passwordHash',
  '*.tokenHash',
  '*.secret',
  '*.description',
  '*.notes',
  '*.amountMinor',
  '*.openingBalanceMinor',
  'password',
  'token',
  'description',
  'notes',
];

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  redact: { paths: REDACT_PATHS, censor: '[redacted]' },
  base: { service: 'mywallet-api' },
});
