import { expect, test } from '@playwright/test';
import { dailyFixture } from '../../../tests/fixtures/market-daily-data';

test('shows a skeleton, then the saved feature, sources, ingredients and secondary trends', async ({ page }) => {
  let release: (() => void) | undefined;
  await page.route('**/market-today-fixture/snapshot', async (route) => {
    await new Promise<void>((resolve) => { release = resolve; });
    await route.fulfill({ json: dailyFixture });
  });
  await page.goto('/tests/fixtures/market-today.html');
  await expect(page.getByRole('status', { name: 'Loading today’s trends…' })).toBeVisible();
  await expect.poll(() => !!release).toBeTruthy();
  release?.();
  await expect(page.getByRole('heading', { name: 'Today’s Trends' })).toBeVisible();
  const featured = page.getByRole('article', { name: 'Pistachio Gelato' });
  await expect(featured.getByText('Rising')).toBeVisible();
  await expect(page.getByText('Demo trends')).toBeVisible();
  await expect(page.locator('time')).toHaveAttribute('datetime', '2026-11-21');
  await expect(featured.getByRole('link', { name: 'Dessert menu report' })).toHaveAttribute('href', 'https://example.com/pistachio');
  await expect(page.getByText('Pistachio Paste', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Strawberry Shortcake' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mango Smoothie' })).toBeVisible();
  await page.getByRole('button', { name: 'Order Ingredients' }).click();
  await expect(page.getByLabel('Trend selection')).toHaveText('pistachio-gelato:ingredients');
});

test('retries a failed read, shows an empty state and retains the saved snapshot during refresh', async ({ page }) => {
  let reads = 0;
  let finish: (() => void) | undefined;
  await page.route('**/market-today-fixture/snapshot', async (route) => {
    if (++reads === 1) return route.fulfill({ status: 503 });
    return route.fulfill({ json: reads === 2 ? { ...dailyFixture, run: null, trends: [] } : dailyFixture });
  });
  await page.route('**/market-today-fixture/job', async (route) => {
    await new Promise<void>((resolve) => { finish = resolve; });
    await route.fulfill({ status: 204 });
  });
  await page.goto('/tests/fixtures/market-today.html');
  await expect(page.getByRole('alert')).toHaveText('Could not load trends.');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText('No trends have been published yet.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Pistachio Gelato', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Run daily job' }).click();
  await expect(page.getByRole('button', { name: 'Run daily job' })).toBeDisabled();
  await expect(page.locator('time')).toHaveAttribute('datetime', '2026-11-21');
  await expect(page.getByRole('article', { name: 'Pistachio Gelato' })).toBeVisible();
  await expect.poll(() => !!finish).toBeTruthy();
  finish?.();
  await expect(page.locator('time')).toHaveAttribute('datetime', '2026-11-22');
  await expect(page.getByText('Trends updated.')).toBeVisible();
});
