import { randomBytes } from 'node:crypto';
import { resetEnvCache } from '../config/env.js';

export function setTestEnv(overrides: Record<string, string> = {}): void {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    MONGODB_URI: process.env.MONGODB_TEST_URI ?? 'mongodb://localhost:27017/mywallet_test',
    APP_ORIGIN: 'http://localhost:5173',
    SESSION_SECRET: randomBytes(32).toString('hex'),
    FIELD_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    REQUIRE_EMAIL_VERIFICATION: 'true',
    ...overrides,
  });
  resetEnvCache();
}
