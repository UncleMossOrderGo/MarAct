import { expect, test } from '@playwright/test';

test('shows shop settings in Thai and English and keeps saved trends after a new run', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/tests/fixtures/market-order-history.html');
  await expect(page.getByRole('heading', { name: 'การตั้งค่า', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'ภาษา' })).toHaveValue('th');
  await expect(page.getByText('MarAct Bakery')).toBeVisible();
  await expect(page.getByText('เบเกอรี')).toBeVisible();

  await page.getByRole('combobox', { name: 'ภาษา' }).selectOption('en');
  await expect(page.getByRole('heading', { name: 'Recent purchases' })).toBeVisible();
  await expect(page.locator('time[datetime="2026-11-21T00:05:00Z"]')).toHaveText('21 Nov 2026, 07:05');
  await page.getByRole('button', { name: 'New trend run' }).click();
  await expect(page.locator('time[datetime="2026-11-22T00:05:00Z"]')).toHaveText('22 Nov 2026, 07:05');

  const history = page.getByRole('region', { name: 'Order history' });
  const currentCard = history.getByRole('article').filter({ hasText: 'order-1' });
  await expect(currentCard.getByText('Related trend: Pistachio Gelato')).toBeVisible();
  await expect(currentCard.getByText('Placed')).toBeVisible();
  await expect(currentCard.getByText('฿4,100.00')).toBeVisible();
  await expect(history.getByRole('article').filter({ hasText: 'order-2' })).not.toContainText('Related trend');
  await currentCard.getByRole('button', { name: 'View order order-1' }).click();
  await expect(page.getByRole('region', { name: 'Selected order' }).getByText('5 kg ×', { exact: false })).toBeVisible();

  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Language' })).toHaveValue('en');
});
