import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/fixtures/market-cart.html');
});

test('edits quantities within stock and submits checkout lines without display data', async ({ page }) => {
  await page.getByRole('button', { name: 'Add mango' }).click();
  await page.getByRole('button', { name: 'Open cart' }).click();
  const cart = page.getByRole('dialog', { name: 'Your cart (1)' });
  const increase = cart.getByRole('button', { name: 'Increase Mango from Tropical Farm quantity' });
  const quantity = cart.getByLabel('Mango from Tropical Farm quantity', { exact: true });
  await expect(quantity).toHaveText('2 kg');
  await increase.click();
  await expect(quantity).toHaveText('3 kg');
  await expect(cart.getByText('฿37.50')).toHaveCount(2);
  await increase.click();
  await expect(increase).toBeDisabled();

  await cart.getByRole('button', { name: 'Continue to checkout' }).click();
  await expect(page.getByLabel('Checkout payload')).toHaveText('[{"listing_id":"mango-1","qty_kg":4}]');
});

test('isolates shop carts and opens a full-screen mobile view', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const shop = page.getByLabel('Active shop');
  const add = page.getByRole('button', { name: 'Add mango' });
  const open = page.getByRole('button', { name: 'Open cart' });
  await add.click();
  await shop.selectOption('bakery');
  await open.click();

  const cart = page.getByRole('dialog');
  await expect(cart.getByText('Your cart is empty.')).toBeVisible();
  await expect(cart).toHaveCSS('width', '390px');
  await page.keyboard.press('Escape');
  await expect(cart).toHaveCount(0);
  await expect(open).toBeFocused();

  await add.click();
  await shop.selectOption('smoothie');
  await open.click();
  await expect(cart.getByRole('heading', { name: 'Your cart (1)' })).toBeVisible();
  await cart.getByRole('button', { name: 'Close cart' }).click();

  await shop.selectOption('bakery');
  await page.getByRole('button', { name: 'Clear Smoothie Café cart' }).click();
  await open.click();
  await expect(cart.getByRole('heading', { name: 'Your cart (1)' })).toBeVisible();
  await cart.getByRole('button', { name: 'Remove Mango from Tropical Farm' }).click();
  await expect(cart.getByText('Your cart is empty.')).toBeVisible();
  await cart.getByRole('button', { name: 'Close cart' }).click();

  await shop.selectOption('smoothie');
  await open.click();
  await expect(cart.getByText('Your cart is empty.')).toBeVisible();
});

test('reserves shared stock across trend lines and restores them after reload', async ({ page }) => {
  await page.getByRole('button', { name: 'Add attributed mango' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Open cart' }).click();
  const cart = page.getByRole('dialog', { name: 'Your cart (2)' });
  await expect(cart.getByText('Mango pudding')).toBeVisible();
  await expect(cart.getByText('Mango smoothie')).toBeVisible();
  for (const increase of await cart.getByRole('button', { name: /Increase Mango/ }).all()) {
    await expect(increase).toBeDisabled();
  }
  await cart.getByRole('button', { name: 'Continue to checkout' }).click();
  await expect(page.getByLabel('Checkout payload')).toHaveText(JSON.stringify([
    { listing_id: 'mango-1', qty_kg: 2, trend_slug: 'dessert' },
    { listing_id: 'mango-1', qty_kg: 2, trend_slug: 'drink' },
  ]));
});
