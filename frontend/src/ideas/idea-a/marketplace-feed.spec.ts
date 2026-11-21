import { expect, test } from '@playwright/test';

test('searches the marketplace by English or Thai name without changing rank', async ({ page }) => {
  const api = '**/api/ideas/idea-a';
  await page.route(`${api}/auth/session`, (route) => route.fulfill({ json: { email: 'buyer@example.test' } }));
  await page.route(`${api}/shops`, (route) => route.fulfill({
    json: { shops: [{ id: 'cafe', name: 'Café', category: 'cafe', menu_tags: [] }] },
  }));
  await page.route(`${api}/trends/latest`, (route) => route.fulfill({ json: { run: null, cards: [] } }));
  await page.route(`${api}/shops/cafe/feed/explanations?*`, (route) => route.fulfill({ status: 204 }));
  await page.route(`${api}/shops/cafe/feed`, (route) => route.fulfill({
    json: { feed_key: 'demo', run_id: null, items: [
      { fruit: { id: 'mango', name_en: 'Mango', name_th: 'มะม่วง' }, listings: [], suggested_kg: 2 },
      { fruit: { id: 'banana', name_en: 'Banana', name_th: 'กล้วย' }, listings: [], suggested_kg: 2 },
    ] },
  }));
  await page.goto('/ideas/idea-a');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const search = page.getByRole('searchbox', { name: 'Search fruit' });
  const results = page.getByRole('list', { name: 'Ranked fruit recommendations' });
  await expect(results.getByRole('listitem')).toHaveCount(2);
  await search.fill(' BANANA ');
  await expect(results.getByRole('listitem')).toHaveCount(1);
  await expect(results.getByLabel('Rank 2')).toBeVisible();
  await search.fill('มะม่วง');
  await expect(results.getByRole('button', { name: 'Mango' })).toBeVisible();
  await search.fill('pear');
  await expect(page.getByRole('status')).toHaveText('No fruit matches your search.');
  await search.clear();
  await expect(results.getByRole('listitem')).toHaveCount(2);
});

const fixturePath = '/tests/fixtures/marketplace-feed.html';

test('shows ranked fruit, price and quantity before updating the active shop explanation', async ({ page }) => {
  await page.goto(fixturePath);
  const feed = page.getByRole('region', { name: 'Personalized marketplace' });
  await expect(feed.getByText('Template for Smoothie Café')).toBeVisible();
  await expect(feed.getByLabel('Rank 1')).toBeVisible();
  await expect(feed.getByRole('img', { name: 'Mango' })).toBeVisible();
  await expect.poll(() => feed.getByRole('img', { name: 'Mango' }).evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(480);
  await expect(feed.getByText('฿72.00 / kg')).toBeVisible();
  await expect(feed.getByText('2 sellers')).toBeVisible();
  await expect(feed.getByText('Suggested 5 kg')).toBeVisible();
  await feed.getByRole('button', { name: 'Mango' }).click();
  await expect(page.getByText('mango', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Emit first stream' }).click();
  await expect(feed.getByText('Previous stream')).toBeVisible();
  await page.getByRole('button', { name: 'Switch shop' }).click();
  await expect(feed.getByText('Template for Bakery')).toBeVisible();
  await expect(feed.getByText('No restock suggested')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-stream-closed', 'true');
  await page.getByRole('button', { name: 'Emit first stream' }).click();
  await expect(feed.getByText('Template for Bakery')).toBeVisible();
  await expect(feed.getByText('Previous stream')).toHaveCount(0);
  await page.getByRole('button', { name: 'Emit latest stream' }).click();
  await expect(feed.getByText('Current stream')).toBeVisible();
});

test('labels the cached run, displays sources and recovers from a failed refresh', async ({ page }) => {
  let refreshCount = 0;
  let releaseFirstRefresh!: () => void;
  const firstRefresh = new Promise<void>((resolve) => { releaseFirstRefresh = resolve; });
  await page.route('**/marketplace-feed-fixture/trends/run', async (route) => {
    refreshCount += 1;
    if (refreshCount === 1) {
      await firstRefresh;
      await route.fulfill({ status: 503 });
      return;
    }
    await route.fulfill({ status: 204 });
  });
  await page.goto(fixturePath);
  const trends = page.getByRole('region', { name: 'Web & social buzz' });
  await expect(trends.getByText('Showing cached trends')).toBeVisible();
  await expect(trends.locator('time')).toContainText('15:30 Bangkok time');
  await expect(trends.getByRole('link', { name: 'Read the source' })).toHaveAttribute('href', 'https://example.com/mango');
  await expect(trends.getByRole('link', { name: 'Invalid source' })).toHaveCount(0);
  await trends.getByRole('button', { name: 'View all trends' }).click();
  await expect(trends.getByText('Menu ideas: Mango shake')).toBeVisible();

  const run = trends.getByRole('button', { name: 'Run trend check' });
  await run.click();
  await expect(run).toBeDisabled();
  await expect(trends.getByRole('status')).toHaveText('Checking trends…');
  releaseFirstRefresh();
  await expect(trends.getByRole('alert')).toHaveText('Could not refresh trends. Try again.');
  await run.click();
  await expect(trends.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText('Refreshes 2')).toBeVisible();
  await expect(run).toBeEnabled();
});
