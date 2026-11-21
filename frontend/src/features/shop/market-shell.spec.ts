import { expect, test } from '@playwright/test';

test('opens Bakery on Today and moves the navigation below content on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/tests/fixtures/market-shell.html?daily');
  const nav = page.getByRole('navigation', { name: 'Marketplace navigation' });
  const today = nav.getByRole('button', { name: 'Today’s Trends' });
  const switcher = page.getByRole('combobox', { name: 'Active shop' });
  await expect(today).toHaveAttribute('aria-current', 'page');
  await expect(switcher).toHaveValue('bakery');
  await expect(page.getByRole('button', { name: 'Continue' })).toHaveCount(0);
  await expect(page.getByText('MarAct', { exact: true }).filter({ visible: true })).toHaveCount(1);
  expect((await nav.boundingBox())!.x).toBeLessThan((await switcher.boundingBox())!.x);
  await today.focus();
  await expect(today).toHaveCSS('outline-style', 'solid');
  await switcher.selectOption('cafe');
  await expect(switcher).toHaveValue('cafe');
  await page.setViewportSize({ width: 360, height: 800 });
  expect((await nav.boundingBox())!.y).toBeGreaterThan((await switcher.boundingBox())!.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
  await expect(page.getByText('MarAct', { exact: true }).filter({ visible: true })).toHaveCount(1);
  await nav.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('status', { name: 'Loading settings' })).toBeVisible();
});

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
