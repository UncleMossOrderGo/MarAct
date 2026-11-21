import { expect, test } from '@playwright/test';

import type { MarketOrderRequest, SavedMarketOrder } from './market-checkout';

const savedOrder: SavedMarketOrder = {
  id: 'order-10024',
  shop_id: 'smoothie',
  status: 'placed',
  total_thb: '28.25',
  created_at: '2026-11-21T03:15:00Z',
  items: [{
    listing_id: 'mango-1',
    fruit_id: 'mango',
    fruit_name: 'Mango',
    seller_name: 'Tropical Farm',
    qty_kg: 5,
    price_per_kg_thb: '5.65',
    line_total_thb: '28.25',
  }],
};

test('replays the same checkout and displays the saved order in its shop', async ({ page }) => {
  const requests: MarketOrderRequest[] = [];
  await page.route('**/component-fixtures/place-order', async (route) => {
    requests.push(route.request().postDataJSON());
    if (requests.length === 1) {
      await route.abort();
      return;
    }
    await route.fulfill({ status: 200, json: savedOrder });
  });
  await page.goto('/tests/fixtures/market-checkout.html');
  await expect(page.getByText('Estimated total')).toBeVisible();
  await expect(page.getByText('฿15.00', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Place order', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Could not place the order. Try again.');
  await page.getByRole('button', { name: 'Back to cart' }).click();
  await page.getByRole('button', { name: 'Review order' }).click();
  await page.getByRole('button', { name: 'Place order', exact: true }).click();

  expect(requests).toHaveLength(2);
  expect(requests[0]).toEqual({
    shop_id: 'smoothie',
    idempotency_key: expect.stringMatching(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i),
    items: [{ listing_id: 'mango-1', qty_kg: 5 }],
  });
  expect(requests[1]).toEqual(requests[0]);

  const receipt = page.getByRole('region', { name: 'Order confirmation' });
  await expect(receipt.getByRole('heading', { name: 'Order saved' })).toBeVisible();
  await expect(receipt.getByText('5 kg ×', { exact: false })).toBeVisible();
  await expect(receipt.getByText('฿28.25', { exact: true })).toHaveCount(2);
  await expect(receipt.locator('.market-order-heading time')).toHaveText('21 Nov 2026, 10:15');
  await receipt.getByRole('button', { name: 'View orders' }).click();
  await expect(page.getByRole('region', { name: 'Order history' }).getByText('5 kg ×', { exact: false })).toBeVisible();

  await page.getByRole('combobox', { name: 'Active shop' }).selectOption('bakery');
  await expect(page.getByText('2 kg ×', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Open order history' }).click();
  await expect(page.getByText('No orders for this shop yet.')).toBeVisible();
  await page.getByRole('combobox', { name: 'Active shop' }).selectOption('smoothie');
  await expect(page.getByText('Your cart is empty.')).toBeVisible();
});

test('reports stock errors and renews the checkout after a quantity change', async ({ page }) => {
  const requests: MarketOrderRequest[] = [];
  await page.route('**/component-fixtures/place-order', async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ status: 422, json: { detail: { message: 'Only 4 kg of mango is available.' } } });
  });
  await page.goto('/tests/fixtures/market-checkout.html');
  const placeOrder = page.getByRole('button', { name: 'Place order', exact: true });
  await placeOrder.click();
  await expect(page.getByRole('alert')).toHaveText('Only 4 kg of mango is available.');

  await page.getByRole('button', { name: 'Back to cart' }).click();
  await page.getByRole('button', { name: 'Change to 4 kg' }).click();
  await page.getByRole('button', { name: 'Review order' }).click();
  await placeOrder.click();

  await expect(page.getByRole('alert')).toHaveText('Only 4 kg of mango is available.');
  expect(requests[1].idempotency_key).not.toBe(requests[0].idempotency_key);
  expect(requests[1].items).toEqual([{ listing_id: 'mango-1', qty_kg: 4 }]);
});

test('preserves ingredient attribution on retry and displays the authoritative saved total', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const requests: MarketOrderRequest[] = [];
  await page.route('**/component-fixtures/place-order', async (route) => {
    requests.push(route.request().postDataJSON());
    if (requests.length <= 2) {
      await route.fulfill({ status: 422, json: { detail: { message: 'Check pistachio paste stock.' } } });
      return;
    }
    await route.fulfill({ json: {
      ...savedOrder, total_thb: '5495.00',
      items: [
        { listing_id: 'pistachio-sweeting', ingredient_id: 'pistachio-paste', ingredient_name: 'Pistachio paste', seller_name: 'Sweetingred Co.', qty_kg: 5, price_per_kg_thb: '820.00', line_total_thb: '4100.00' },
        { listing_id: 'cream-dairypro', ingredient_id: 'whipping-cream', ingredient_name: 'Whipping cream', seller_name: 'DairyPro', qty_kg: 5, price_per_kg_thb: '195.00', line_total_thb: '975.00' },
        { listing_id: 'milk-thaidairy', ingredient_id: 'milk', ingredient_name: 'Milk', seller_name: 'ThaiDairy', qty_kg: 10, price_per_kg_thb: '42.00', line_total_thb: '420.00' },
      ].map((item) => ({ ...item, trend_slug: 'pistachio-gelato', trend_label: 'Pistachio Gelato' })),
    } });
  });
  await page.goto('/tests/fixtures/market-checkout.html?ingredients');
  await expect(page.getByText('฿3,035.00')).toBeVisible();
  const placeOrder = page.getByRole('button', { name: 'Place order', exact: true });
  await placeOrder.click();
  await expect(page.getByRole('alert')).toHaveText('Check pistachio paste stock.');
  await placeOrder.click();
  await expect(page.getByRole('alert')).toHaveText('Check pistachio paste stock.');
  expect(requests[1]).toEqual(requests[0]);

  await page.getByRole('button', { name: 'Back to cart' }).click();
  await page.getByRole('button', { name: 'Change pistachio to 5 kg' }).click();
  await page.getByRole('button', { name: 'Review order' }).click();
  await placeOrder.click();
  expect(requests[2].idempotency_key).not.toBe(requests[0].idempotency_key);
  expect(requests[2].items).toContainEqual({ listing_id: 'pistachio-sweeting', qty_kg: 5, trend_slug: 'pistachio-gelato' });
  const receipt = page.getByRole('region', { name: 'Order confirmation' });
  await expect(receipt.getByText('฿5,495.00')).toBeVisible();
  await expect(receipt.getByText('Related trend: Pistachio Gelato')).toBeVisible();
  await expect(receipt.getByRole('button', { name: 'Back to Trends' })).toBeVisible();
});
