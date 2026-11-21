import { expect, test } from '@playwright/test';

const root = '/api/shop/shops/bakery-main';
const thread = { id: 'thread-1', title: 'Gelato stock' };
function reply(event: string, data: object) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

test('opens a mobile assistant, uses focused context, and adds only after the buyer clicks', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let reads = 0;
  let sends = 0;
  await page.route(`**${root}/agent/threads`, (route) => {
    if (route.request().method() === 'POST') return route.fulfill({ json: thread });
    reads++;
    return route.fulfill({ json: { threads: reads > 1 ? [thread] : [] } });
  });
  await page.route(`**${root}/agent/threads/${thread.id}/messages`, (route) => {
    sends++;
    expect(route.request().postDataJSON()).toMatchObject({
      message: 'Do I have enough stock for this trend?',
      page_context: { page: 'trend', focused: { type: 'trend', id: 'gelato' } },
    });
    return route.fulfill({ contentType: 'text/event-stream', body: [
      reply('tool', { type: 'tool', id: '1', name: 'get_shop_stock', state: 'running' }),
      reply('tool', { type: 'tool', id: '1', name: 'get_shop_stock', state: 'done' }),
      reply('text', { delta: '**Three days of milk remain.**\n- [Read the source](https://example.com/gelato)\n- [Unverified](https://offsite.example)' }),
      reply('actions', [
        { type: 'add_to_cart', listing_id: 'milk', ingredient_name: 'Milk', seller_name: 'Dairy',
          price_per_kg_thb: '42.00', qty_kg: 2, stock_kg: 8, trend_slug: 'gelato' },
        { type: 'tool', id: '1', name: 'get_shop_stock', state: 'done' },
        { type: 'source', url: 'https://example.com/gelato', title: 'Trend reference' },
      ]),
      reply('done', {}),
    ].join('') });
  });

  await page.goto('/tests/fixtures/market-assistant.html');
  await expect(page.getByRole('button', { name: 'Ask agent' })).toBeVisible();
  expect(reads).toBe(0);
  expect(sends).toBe(0);
  await page.getByRole('button', { name: 'Ask agent' }).click();
  const panel = page.getByRole('dialog', { name: 'MarAct Assistant' });
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Do I have enough stock for this trend?' }).click();
  await expect(panel.locator('strong').filter({ hasText: 'Three days of milk remain.' })).toBeVisible();
  await expect(panel.getByRole('list', { name: 'Tool activity' })).toContainText('Inventory check');
  await expect(panel.getByRole('link', { name: 'Read the source' })).toHaveAttribute('href', 'https://example.com/gelato');
  await expect(panel.getByRole('link', { name: 'Unverified' })).toHaveCount(0);
  await expect(panel.getByRole('link', { name: 'Trend reference' })).toHaveAttribute('href', 'https://example.com/gelato');
  await expect(page.getByText('2 kg Milk', { exact: true })).toHaveCount(0);
  await panel.getByRole('button', { name: /Add to cart.*Milk/ }).click();
  await expect(panel).toBeHidden();
  await expect(page.getByRole('status')).toHaveText('2 kg Milk');
  expect(sends).toBe(1);
});

test('shows assistant errors and retries the same request', async ({ page }) => {
  const requestIds: string[] = [];
  await page.route(`**${root}/agent/threads`, (route) => route.fulfill({
    json: route.request().method() === 'POST' ? thread : { threads: [] },
  }));
  await page.route(`**${root}/agent/threads/${thread.id}/messages`, (route) => {
    requestIds.push(route.request().postDataJSON().request_id);
    const frames = requestIds.length === 1
      ? reply('error', { code: 'assistant_unavailable' })
      : reply('text', { delta: 'Bakery gelato cake and milk buns.' }) + reply('done', {});
    return route.fulfill({ contentType: 'text/event-stream', body: frames });
  });
  await page.goto('/tests/fixtures/market-assistant.html');
  await page.getByRole('button', { name: 'Ask agent' }).click();
  await page.getByRole('textbox', { name: 'Ask about your shop, trends, or orders' }).fill('Menu ideas');
  await page.getByRole('textbox').press('Shift+Enter');
  expect(requestIds).toHaveLength(0);
  await page.getByRole('textbox').press('Enter');
  await expect(page.getByRole('alert')).toContainText('The agent is unavailable');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText('Bakery gelato cake and milk buns.')).toBeVisible();
  expect(requestIds).toHaveLength(2);
  expect(requestIds[0]).toBe(requestIds[1]);
});
