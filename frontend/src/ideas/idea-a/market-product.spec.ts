import { expect, test } from '@playwright/test';

test('compares two offers and passes the chosen seller and quantity to the cart', async ({ page }) => {
  await page.goto('/tests/fixtures/market-product.html');
  await expect(page.getByRole('heading', { name: 'Mango' })).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(2);
  const quantity = page.getByRole('spinbutton', { name: 'Quantity (kg)' });
  await expect(quantity).toHaveValue('1');
  await expect(quantity).toHaveAttribute('max', '500');
  const add = page.getByRole('button', { name: 'Add to cart' });
  await quantity.fill('501');
  await expect(add).toBeDisabled();
  await page.getByRole('radio', { name: /Sunrise Fruits/ }).check();
  await expect(quantity).toHaveAttribute('max', '3');
  await page.getByRole('button', { name: 'Increase quantity' }).click();
  await page.getByRole('button', { name: 'Increase quantity' }).click();
  await expect(page.getByRole('button', { name: 'Increase quantity' })).toBeDisabled();
  await quantity.fill('2.5');
  await expect(add).toBeDisabled();
  await quantity.fill('3');
  await add.click();
  const handoff = page.getByLabel('Cart handoff');
  await expect(handoff).toHaveText(JSON.stringify({
    listing_id: 'sunrise', qty_kg: 3, fruit_name: 'Mango', seller_name: 'Sunrise Fruits',
    price_per_kg_thb: '52.00', stock_kg: 3,
  }));
  await page.getByRole('button', { name: 'Back to marketplace' }).click();
  await expect(page.getByRole('heading', { name: 'Marketplace' })).toBeVisible();
  await expect(handoff).toContainText('"listing_id":"sunrise"');
});

test('shows disabled seller choices when stock is unavailable', async ({ page }) => {
  await page.goto('/tests/fixtures/market-product.html?unavailable');
  await expect(page.getByRole('radio', { name: /Tropical Farm/ })).toBeDisabled();
  await expect(page.getByRole('radio', { name: /Sunrise Fruits/ })).toBeDisabled();
  await expect(page.getByText('No offers available.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add to cart' })).toHaveCount(0);
});
