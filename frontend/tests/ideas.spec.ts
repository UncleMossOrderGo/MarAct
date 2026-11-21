import { expect, test } from '@playwright/test';
import { defaultIdeaId, demoIdeas, ideaPath } from '../src/ideas/registry';

const ideaA = '/api/ideas/idea-a';
const ideaBRecords = '/api/ideas/idea-b/records';
const bakery = 'bakery-main';
const trend = 'pistachio-gelato';
const today = (locale: 'th' | 'en') => `${ideaA}/shops/${bakery}/today?locale=${locale}`;

type CheckoutPayload = {
  shop_id: string;
  idempotency_key: string;
  items: { listing_id: string; qty_kg: number; trend_slug?: string }[];
};

test('root opens the configured default demo', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(ideaPath(defaultIdeaId));
  await expect(page.getByRole('combobox', { name: 'Idea', exact: true })).toHaveValue(defaultIdeaId);
  await expect(page.getByRole('option')).toHaveText(demoIdeas.map(({ label }) => label));
});

test('Bakery orders the daily ingredient bundle and keeps it after refreshing trends', async ({ page, request }) => {
  const beforeB = await request.get(ideaBRecords);
  expect(beforeB.status()).toBe(200);
  const ideaBData = await beforeB.json();

  const shopsResponse = await request.get(`${ideaA}/shops`);
  expect(shopsResponse.status()).toBe(200);
  expect(await shopsResponse.json()).toMatchObject({
    default_shop_id: bakery,
    shops: [{ id: bakery, name: 'MarAct Bakery', category: 'bakery' }],
  });

  const firstResponse = await request.get(today('th'));
  expect(firstResponse.status()).toBe(200);
  const firstSnapshot = await firstResponse.json();
  expect(firstSnapshot).toMatchObject({
    shop: { id: bakery },
    run: { id: expect.any(String), trend_date: '2026-11-21', source: 'seed' },
  });
  expect(firstSnapshot.trends[0]).toMatchObject({
    slug: trend,
    name: 'เจลาโตพิสตาชิโอ',
    sources: expect.arrayContaining([expect.objectContaining({
      url: expect.stringMatching(/^https:\/\/example\.com\//),
    })]),
  });

  await page.goto('/ideas/idea-a');
  await expect(page.getByText('เจลาโตพิสตาชิโอ', { exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByText('เจลาโตพิสตาชิโอ', { exact: true }).first()).toBeVisible();

  // Keep the shopper flow in English after checking the default Thai result.
  const navigation = page.getByRole('navigation', { name: /marketplace navigation|เมนูหลัก/i });
  await navigation.getByRole('button', { name: /settings|ตั้งค่า/i }).click();
  await page.getByRole('combobox', { name: 'ภาษา', exact: true }).selectOption('en');
  await navigation.getByRole('button', { name: /today|วันนี้/i }).click();
  await expect(page.getByText('Pistachio Gelato', { exact: true }).first()).toBeVisible();

  const readCalls = await request.get('/api/__test/idea-a/provider-calls');
  expect(readCalls.status()).toBe(200);
  expect(await readCalls.json()).toEqual({ calls: 0 });

  const ingredientPanel = page.locator('.market-today-desktop-order');
  await expect(ingredientPanel.getByRole('combobox', { name: /compare sellers: pistachio paste/i }).locator('option'))
    .toHaveCount(2);
  const selectedQuantity = ingredientPanel.getByRole('spinbutton', { name: /pistachio paste quantity/i });
  await expect(selectedQuantity).toHaveValue('2');
  await selectedQuantity.fill('5');
  await page.getByRole('button', { name: /add all/i }).click();
  const cart = page.getByRole('dialog');
  await expect(cart.getByRole('status', {
    name: 'Pistachio Paste from Sweetingred Co. (Pistachio Gelato) quantity',
  })).toHaveText('5 kg');
  await cart.getByRole('button', { name: /continue to checkout/i }).click();

  const placing = page.waitForResponse((response) =>
    new URL(response.url()).pathname === `${ideaA}/orders` && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Place order', exact: true }).click();
  const placed = await placing;
  expect(placed.status(), await placed.text()).toBe(201);
  const order = await placed.json();
  const submitted = placed.request().postDataJSON() as CheckoutPayload;
  expect(submitted).toMatchObject({
    shop_id: bakery,
    items: expect.arrayContaining([
      { listing_id: 'pistachio-sweeting', qty_kg: 5, trend_slug: trend },
      { listing_id: 'cream-dairypro', qty_kg: 5, trend_slug: trend },
      { listing_id: 'milk-thaidairy', qty_kg: 10, trend_slug: trend },
    ]),
  });
  expect(order).toMatchObject({ id: expect.any(String), total_thb: '5495.00' });
  expect(order.items).toHaveLength(3);
  expect(order.orders).toHaveLength(3);
  await expect(page.getByRole('heading', { name: 'Demo PromptPay' })).toBeVisible();
  await expect(page.getByText(/5,495\.00/).first()).toBeVisible();

  const replay = await request.post(`${ideaA}/orders`, {
    data: { ...submitted, items: submitted.items.map((item) => ({
      ...item, qty_kg: 1, price_per_kg_thb: '0.01',
    })) },
  });
  expect(replay.status(), await replay.text()).toBe(200);
  expect(await replay.json()).toEqual(order);

  const listing = await request.get(`${ideaA}/listings`);
  expect(listing.status()).toBe(200);
  expect((await listing.json()).listings).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'pistachio-sweeting', stock_kg: 20 }),
    expect.objectContaining({ id: 'cream-dairypro', stock_kg: 25 }),
    expect.objectContaining({ id: 'milk-thaidairy', stock_kg: 40 }),
  ]));

  const firstSellerOrder = order.orders[0];
  await page.getByRole('button', { name: 'I’ve paid' }).first().click();
  await expect(page.getByText('Demo payment receipt')).toBeVisible();
  const paidInbox = await request.get(`${ideaA}/notifications`, {
    params: { recipient_type: 'seller', recipient_id: firstSellerOrder.seller_id },
  });
  expect(await paidInbox.json()).toMatchObject({
    notifications: expect.arrayContaining([expect.objectContaining({ kind: 'order_paid' })]),
  });
  await page.getByRole('button', { name: 'View as seller' }).click();
  await expect(page).toHaveURL('/ideas/idea-a/seller');
  await page.getByRole('combobox', { name: 'Supplier', exact: true }).selectOption(firstSellerOrder.seller_id);
  const confirming = page.waitForResponse((response) =>
    response.request().method() === 'POST' &&
    new URL(response.url()).pathname === `${ideaA}/orders/${firstSellerOrder.id}/confirm`);
  await page.getByRole('button', { name: 'Confirm order', exact: true }).click();
  expect((await confirming).status()).toBe(200);
  const confirmed = await request.get(`${ideaA}/orders/${firstSellerOrder.id}`);
  expect(await confirmed.json()).toMatchObject({ status: 'confirmed' });
  const buyerInbox = await request.get(`${ideaA}/notifications`, {
    params: { recipient_type: 'shop', recipient_id: bakery },
  });
  expect(await buyerInbox.json()).toMatchObject({
    notifications: expect.arrayContaining([expect.objectContaining({ kind: 'order_confirmed' })]),
  });
  const groupBeforeRefresh = await (await request.get(`${ideaA}/orders/${order.id}`)).json();
  await page.getByRole('button', { name: 'View as shop' }).click();

  await navigation.getByRole('button', { name: /today/i }).click();
  const requesting = page.waitForResponse((response) =>
    new URL(response.url()).pathname === `${ideaA}/jobs/daily-trend/demo` &&
    response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Run daily job', exact: true }).click();
  const accepted = await requesting;
  expect(accepted.status(), await accepted.text()).toBe(202);
  const attempt = await accepted.json();
  expect(attempt).toMatchObject({ attempt_id: expect.any(String) });
  expect(await accepted.request().headerValue('x-job-token')).toBeNull();
  await expect.poll(async () => {
    const response = await request.get(`${ideaA}/jobs/daily-trend/latest`);
    return response.ok() ? response.json() : null;
  }).toMatchObject({
    attempt: { attempt_id: attempt.attempt_id, state: 'published' },
    latest_usable: { id: expect.any(String), source: 'seed', status: 'fallback' },
  });
  const refreshed = await request.get(today('en'));
  expect(refreshed.status()).toBe(200);
  const refreshedSnapshot = await refreshed.json();
  expect(refreshedSnapshot.run.id).toBe(attempt.attempt_id);
  expect(refreshedSnapshot.run.id).not.toBe(firstSnapshot.run.id);
  await expect(page.getByRole('status').filter({ hasText: 'Trends updated.' })).toBeVisible();
  await expect(page.getByText('Pistachio Gelato', { exact: true }).first()).toBeVisible();

  const saved = await request.get(`${ideaA}/orders/${order.id}`);
  expect(saved.status()).toBe(200);
  expect(await saved.json()).toEqual(groupBeforeRefresh);
  const history = await request.get(`${ideaA}/shops/${bakery}/orders`);
  expect(history.status()).toBe(200);
  expect((await history.json()).orders).toContainEqual(groupBeforeRefresh);

  await navigation.getByRole('button', { name: 'Orders', exact: true }).click();
  await expect(page.getByText(/5,495\.00/).first()).toBeVisible();
  await expect(page.getByText(/pistachio gelato/i).first()).toBeVisible();

  const totalCalls = await request.get('/api/__test/idea-a/provider-calls');
  expect(await totalCalls.json()).toEqual({ calls: 0 });
  const switcher = page.getByRole('combobox', { name: 'Idea', exact: true });
  await switcher.selectOption('idea-b');
  await expect(page).toHaveURL('/ideas/idea-b');
  await expect(page.getByRole('heading', { name: 'Idea B' })).toBeVisible();
  const afterB = await request.get(ideaBRecords);
  expect(afterB.status()).toBe(200);
  expect(await afterB.json()).toEqual(ideaBData);
  expect((await request.get('/api/ideas/idea-b/shops')).status()).toBe(404);
  expect((await request.get(`${ideaA}/auth/session`)).status()).toBe(404);
  expect((await request.get(`${ideaA}/shops/${bakery}/feed`)).status()).toBe(404);
});
