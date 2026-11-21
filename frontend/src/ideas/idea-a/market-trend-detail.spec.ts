import { expect, test } from '@playwright/test';

test('reads saved evidence and reaches ingredients with the keyboard on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/tests/fixtures/market-trend-detail.html');
  await expect(page.getByRole('heading', { name: 'Pistachio Gelato' })).toBeVisible();
  await expect(page.getByText('Pistachio Gelato Cake')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Dessert menu report' })).toBeVisible();
  await expect(page.locator('time')).toHaveAttribute('datetime', '2026-11-21T06:00:04+07:00');
  const overview = page.getByRole('tab', { name: 'Overview' });
  await overview.focus();
  await overview.press('ArrowRight');
  const ingredients = page.getByRole('tab', { name: 'Ingredients' });
  await expect(ingredients).toBeFocused();
  await expect(ingredients).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Kataifi topping')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Milk' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test('caps whole kilograms and adds only eligible selected offers with trend attribution', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/tests/fixtures/market-trend-detail.html');
  await page.getByRole('button', { name: 'Order Ingredients' }).click();
  const seller = page.getByRole('combobox', { name: 'Compare sellers: Pistachio Paste' });
  await seller.selectOption('pistachio-bakemate');
  await expect(page.getByText('฿870.00 / kg', { exact: true })).toBeVisible();
  const quantity = page.getByRole('spinbutton', { name: 'Pistachio Paste Quantity (kg)' });
  await expect(quantity).toHaveAttribute('max', '20');
  const add = page.getByRole('button', { name: 'Add All to Cart' });
  await quantity.fill('21');
  await expect(add).toBeDisabled();
  await quantity.fill('20');
  await expect(page.getByRole('button', { name: 'Increase Pistachio Paste' })).toBeDisabled();
  await quantity.fill('4');
  await page.getByRole('button', { name: 'Increase Pistachio Paste' }).click();
  await page.getByRole('checkbox', { name: 'Select Milk' }).uncheck();
  await add.click();
  const payload = JSON.parse(await page.getByLabel('Cart payload').innerText());
  expect(payload).toEqual([
    expect.objectContaining({ listing_id: 'pistachio-bakemate', qty_kg: 5, trend_slug: 'pistachio-gelato',
      trend_label: 'Pistachio Gelato', ingredient_name: 'Pistachio Paste', seller_name: 'BakeMate' }),
    expect.objectContaining({ listing_id: 'cream-dairypro', qty_kg: 5, trend_slug: 'pistachio-gelato' }),
  ]);
  await expect(page.getByText('Ingredients added to cart.')).toBeVisible();
});
