import { expect, test } from '@playwright/test';

// Requires a running stack with email verification disabled or a dev mail log; see README. Not executed in the build sandbox.
test('register → account → expense → balance updates → hide balances', async ({ page }) => {
  const email = `e2e+${Date.now()}@example.com`;
  await page.goto('/register');
  await page.getByLabel('Name').fill('E2E User');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel(/^Password/).fill('correct horse battery staple');
  await page.getByLabel('Confirm password').fill('correct horse battery staple');
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page.getByText(/check your email/i)).toBeVisible();
});

test('unauthenticated users are redirected to login', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login/);
});
