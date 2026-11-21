import { expect, test } from '@playwright/test';

test('selects a shop, navigates its profile, and switches cart context', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/tests/fixtures/market-shell.html');

  await expect(page.getByRole('radio', { name: 'Smoothie Café' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Bakery' })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Café', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();
  const nav = page.getByRole('navigation', { name: 'Marketplace navigation' });
  await expect(nav.getByRole('button', { name: 'Marketplace' })).toHaveAttribute('aria-current', 'page');
  await nav.getByRole('button', { name: 'Trends' }).click();
  await expect(page.getByRole('heading', { name: 'trends' })).toBeVisible();
  await nav.getByRole('button', { name: 'Orders' }).click();
  await expect(page.getByRole('heading', { name: 'orders' })).toBeVisible();
  await nav.getByRole('button', { name: 'Shop Profile' }).click();
  await expect(page.getByText('tropical', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cart (2)' }).click();
  await expect(page.getByRole('status')).toHaveText('Cart opened for smoothie');

  await page.getByRole('combobox', { name: 'Active shop' }).selectOption('bakery');
  await page.getByRole('button', { name: 'Cart (0)' }).click();
  await expect(page.getByRole('status')).toHaveText('Cart opened for bakery');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
});
