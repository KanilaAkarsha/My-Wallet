import { defineConfig } from '@playwright/test';

/** E2E needs the full stack (API + MongoDB replica set + frontend). See docs/DEPLOYMENT.md; run `docker compose up` first. */
export default defineConfig({
  testDir: 'e2e',
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173', trace: 'retain-on-failure' },
  projects: [{ name: 'desktop', use: { viewport: { width: 1280, height: 800 } } }, { name: 'mobile', use: { viewport: { width: 390, height: 844 } } }],
});
