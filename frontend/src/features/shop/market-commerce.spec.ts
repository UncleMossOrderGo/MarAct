import { expect, test } from '@playwright/test';

const created = '2026-11-21T02:00:00Z';
const placed = {
  id: 'order-a', shop_id: 'bakery', seller_id: 'seller-a', seller_name: 'Fresh Orchard',
  total_thb: '12.00', created_at: created, status: 'placed', items: [],
};
const paid = { ...placed, status: 'paid', paid_at: created, payment_ref: 'DEMO-123' };
const confirmed = { ...paid, status: 'confirmed', confirmed_at: created };

test('pays only the chosen supplier, then confirms from the seller workspace', async ({ page }) => {
  let order = placed;
  await page.route('**/api/shop/notifications?*', (route) =>
    route.fulfill({ json: { notifications: [], unread_count: 0 } }));
  await page.route('**/api/shop/sellers', (route) => route.fulfill({
    json: { sellers: [{ id: 'seller-a', name: 'Fresh Orchard' }, { id: 'seller-b', name: 'Dairy Lane' }] },
  }));
  await page.route('**/sellers/seller-a/orders', (route) => route.fulfill({ json: { orders: [order] } }));
  await page.route('**/sellers/seller-b/orders', (route) => route.fulfill({ json: { orders: [] } }));
  await page.route('**/orders/order-a/pay', (route) => {
    expect(route.request().postDataJSON()).toEqual({ shop_id: 'bakery' });
    order = paid;
    return route.fulfill({ json: order });
  });
  await page.route('**/orders/order-a/confirm', (route) => {
    expect(route.request().postDataJSON()).toEqual({ seller_id: 'seller-a' });
    order = confirmed;
    return route.fulfill({ json: order });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/tests/fixtures/market-commerce.html');
  await expect(page.getByText('Demo only. This QR code cannot transfer money.')).toBeVisible();
  const first = page.getByRole('article', { name: 'Order order-a' });
  const second = page.getByRole('article', { name: 'Order order-b' });
  await expect(first.getByRole('img', { name: 'Non-payable demo QR code' })).toBeVisible();
  await first.getByRole('button', { name: 'I’ve paid' }).click();
  await expect(first.getByText('Reference: DEMO-123')).toBeVisible();
  await expect(second.getByRole('button', { name: 'I’ve paid' })).toBeEnabled();
  await page.getByRole('button', { name: 'View as seller' }).click();
  await expect(page.getByText('Kataifi')).toBeVisible();
  await page.getByRole('button', { name: 'Confirm order' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Order confirmed.' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Order status' }).getByText('Confirmed')).toBeVisible();
  await page.getByRole('combobox', { name: 'Supplier' }).selectOption('seller-b');
  await expect(page.getByText('No orders for this supplier yet.')).toBeVisible();
  await expect(page.getByText('Order order-a')).toHaveCount(0);
});

test('opens a scoped notification, marks it read and updates the unread count', async ({ page }) => {
  let read = false;
  await page.route('**/api/shop/notifications?*', (route) => {
    const query = new URL(route.request().url()).searchParams;
    expect(query.get('recipient_type')).toBe('shop');
    expect(query.get('recipient_id')).toBe('bakery');
    return route.fulfill({ json: { unread_count: read ? 0 : 1, notifications: [{
      id: 'notice-a', kind: 'order_confirmed', title: 'Order confirmed', body: 'Fresh Orchard confirmed the order.',
      link: '/ideas/idea-a?order=order-a', read_at: read ? created : null, created_at: created,
    }] } });
  });
  await page.route('**/notifications/notice-a/read', (route) => {
    expect(route.request().postDataJSON()).toEqual({ recipient_type: 'shop', recipient_id: 'bakery' });
    read = true;
    return route.fulfill({ status: 204 });
  });
  await page.goto('/tests/fixtures/market-commerce.html');
  await page.getByRole('button', { name: 'Notifications: 1 unread' }).click();
  await page.getByRole('button', { name: /Order confirmed/ }).click();
  await expect(page.getByText('/ideas/idea-a?order=order-a')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible();
});

test('refreshes an expired demo code without replacing the placed order', async ({ page }) => {
  await page.clock.install({ time: new Date(created) });
  await page.route('**/api/shop/notifications?*', (route) =>
    route.fulfill({ json: { notifications: [], unread_count: 0 } }));
  await page.goto('/tests/fixtures/market-commerce.html');
  const order = page.getByRole('article', { name: 'Order order-a' });
  await expect(order.getByRole('timer')).toHaveText(/^4:59$|^5:00$/);
  await page.clock.fastForward(301_000);
  await expect(order.getByText('This demo code expired.')).toBeVisible();
  await expect(order.getByRole('button', { name: 'I’ve paid' })).toHaveCount(0);
  await order.getByRole('button', { name: 'Get a new demo code' }).click();
  await expect(order.getByRole('timer')).toHaveText(/^4:59$|^5:00$/);
  await expect(order.getByRole('button', { name: 'I’ve paid' })).toBeEnabled();
});
