import { expect, test } from '@playwright/test';
import { defaultIdeaId, demoIdeas, ideaPath } from '../src/ideas/registry';
import type { MarketOrderRequest, SavedMarketOrder } from '../src/ideas/idea-a/market-checkout';

const ideaA = '/api/ideas/idea-a';
const ideaBRecords = '/api/ideas/idea-b/records';

test('root opens the configured default demo', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(ideaPath(defaultIdeaId));
  await expect(page.getByRole('combobox', { name: 'Idea' })).toHaveValue(defaultIdeaId);
  await expect(page.getByRole('option')).toHaveText(demoIdeas.map(({ label }) => label));
});

test('seeded marketplace checkout saves the server price and replays without affecting Idea B', async ({ page, request }) => {
  const beforeB = await request.get(ideaBRecords);
  expect(beforeB.ok()).toBeTruthy();
  const ideaBData = await beforeB.json();

  expect((await request.get(`${ideaA}/shops`)).status()).toBe(401);
  await page.goto('/ideas/idea-a');
  await page.getByLabel('Email').fill('buyer@example.test');
  await page.getByLabel('Password').fill('test-demo-password');
  const signingIn = page.waitForResponse((response) => new URL(response.url()).pathname === `${ideaA}/auth/login`);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  const login = await signingIn;
  expect(login.status(), await login.text()).toBe(200);
  const buyer = page.request;
  await page.getByRole('radio', { name: 'Smoothie Café' }).check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('Showing cached trends')).toBeVisible();

  const ranked = page.getByRole('list', { name: 'Ranked fruit recommendations' });
  const mango = ranked.getByRole('listitem').first();
  await expect(mango.getByRole('button', { name: 'Mango', exact: true })).toBeVisible();
  await expect(mango).toContainText('2 sellers');
  await mango.getByRole('button', { name: 'Mango', exact: true }).click();

  const product = page.getByRole('region', { name: 'Product detail' });
  await expect(product.getByRole('radio')).toHaveCount(2);
  await product.getByRole('spinbutton', { name: 'Quantity (kg)' }).fill('5');
  await product.getByRole('button', { name: 'Add to cart' }).click();
  await page.getByRole('button', { name: 'Cart (1)', exact: true }).click();
  await page.getByRole('button', { name: 'Continue to checkout' }).click();

  const placing = page.waitForResponse((response) =>
    new URL(response.url()).pathname === `${ideaA}/orders` && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Place order', exact: true }).click();
  const placed = await placing;
  expect(placed.status()).toBe(201);
  const order = await placed.json() as SavedMarketOrder;
  const body = placed.request().postDataJSON() as MarketOrderRequest;
  expect(order.items).toHaveLength(1);
  expect(order.items[0]).toMatchObject({
    fruit_id: 'mango', qty_kg: 5, price_per_kg_thb: '78.00', line_total_thb: '390.00',
  });
  expect(order.total_thb).toBe('390.00');
  await expect(page.getByRole('heading', { name: 'Order saved' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Order confirmation' })).toContainText('5 kg');

  const replay = await buyer.post(`${ideaA}/orders`, {
    data: { ...body, items: body.items.map((item) => ({ ...item, qty_kg: 1, price_per_kg_thb: '0.01' })) },
  });
  expect(replay.status()).toBe(200);
  expect(await replay.json()).toEqual(order);
  const listingResponse = await buyer.get(`${ideaA}/listings?fruit_id=mango`);
  expect(listingResponse.ok()).toBeTruthy();
  expect((await listingResponse.json()).listings).toContainEqual(expect.objectContaining({
    id: body.items[0].listing_id, stock_kg: 31,
  }));

  await page.getByRole('button', { name: 'Trends', exact: true }).click();
  const previousTrends = await buyer.get(`${ideaA}/trends/latest`);
  expect(previousTrends.ok()).toBeTruthy();
  const previousRun = (await previousTrends.json()).run.id;
  const refresh = page.waitForResponse((response) => new URL(response.url()).pathname === `${ideaA}/trends/run`);
  await page.getByRole('button', { name: 'Run trend check' }).click();
  const refreshed = await refresh;
  expect(refreshed.ok()).toBeTruthy();
  const newRun = await refreshed.json();
  expect(newRun).toMatchObject({ status: 'fallback', run_id: expect.any(String) });
  expect(newRun.run_id).not.toBe(previousRun);
  const latest = await buyer.get(`${ideaA}/trends/latest`);
  expect(latest.ok()).toBeTruthy();
  expect((await latest.json()).run.id).toBe(newRun.run_id);
  await expect(page.getByText('Showing cached trends')).toBeVisible();
  const persisted = await buyer.get(`${ideaA}/orders/${order.id}`);
  expect(persisted.ok()).toBeTruthy();
  expect(await persisted.json()).toEqual(order);

  await page.reload();
  await page.getByRole('button', { name: 'Orders', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Order history' })).toContainText('5 kg');
  const switcher = page.getByRole('combobox', { name: 'Idea', exact: true });
  await switcher.selectOption('idea-b');
  await expect(page).toHaveURL('/ideas/idea-b');
  await expect(page.getByRole('heading', { name: 'Idea B' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Order history' })).toHaveCount(0);
  const afterB = await request.get(ideaBRecords);
  expect(afterB.ok()).toBeTruthy();
  expect(await afterB.json()).toEqual(ideaBData);
  expect((await request.get('/api/ideas/idea-b/shops')).status()).toBe(404);
  expect((await request.get(`${ideaA}/plans/current`)).status()).toBe(404);
});
