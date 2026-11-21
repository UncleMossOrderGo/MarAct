import { expect, test } from '@playwright/test';
import { dailyFixture } from '../../../tests/fixtures/market-daily-data';

test('shows a skeleton, then the saved feature, sources, ingredients and secondary trends', async ({ page }) => {
  let release: (() => void) | undefined;
  await page.route('**/market-today-fixture/snapshot', async (route) => {
    await new Promise<void>((resolve) => { release = resolve; });
    await route.fulfill({ json: dailyFixture });
  });
  await page.goto('/tests/fixtures/market-today.html');
  await expect(page.getByRole('status', { name: 'Loading today’s trends…' })).toBeVisible();
  await expect.poll(() => !!release).toBeTruthy();
  release?.();
  await expect(page.getByRole('heading', { name: 'Today’s Trends' })).toBeVisible();
  const featured = page.getByRole('article', { name: 'Pistachio Gelato' });
  await expect(featured.getByText('Rising')).toBeVisible();
  await expect(page.getByText('Demo trends')).toBeVisible();
  await expect(page.locator('time')).toHaveAttribute('datetime', '2026-11-21T06:00:04+07:00');
  await expect(page.locator('time')).toContainText('06:00');
  await expect(featured.getByRole('link', { name: 'Dessert menu report' })).toHaveAttribute('href', 'https://example.com/pistachio');
  await expect(page.getByText('Pistachio Paste', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Strawberry Shortcake' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mango Smoothie' })).toBeVisible();
  await page.getByRole('button', { name: 'Order Ingredients' }).click();
  await expect(page.getByLabel('Trend selection')).toHaveText('pistachio-gelato:ingredients');
});

test('retries a failed read, shows an empty state and retains the saved snapshot during refresh', async ({ page }) => {
  let reads = 0;
  let finish: (() => void) | undefined;
  await page.route('**/market-today-fixture/snapshot', async (route) => {
    if (++reads === 1) return route.fulfill({ status: 503 });
    return route.fulfill({ json: reads === 2 ? { ...dailyFixture, run: null, trends: [] } : dailyFixture });
  });
  await page.route('**/market-today-fixture/job', async (route) => {
    await new Promise<void>((resolve) => { finish = resolve; });
    await route.fulfill({ status: 204 });
  });
  await page.goto('/tests/fixtures/market-today.html');
  await expect(page.getByRole('alert')).toHaveText('Could not load trends.');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText('No trends have been published yet.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Pistachio Gelato', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Run daily job' }).click();
  await expect(page.getByRole('button', { name: 'Run daily job' })).toBeDisabled();
  await expect(page.getByRole('progressbar')).toBeVisible();
  await expect(page.locator('time')).toHaveAttribute('datetime', '2026-11-21T06:00:04+07:00');
  await expect(page.getByRole('article', { name: 'Pistachio Gelato' })).toBeVisible();
  await expect.poll(() => !!finish).toBeTruthy();
  finish?.();
  await expect(page.locator('time')).toHaveAttribute('datetime', '2026-11-22T06:01:00+07:00');
  await expect(page.getByText('Trends updated.')).toBeVisible();
  await expect(page.getByRole('progressbar')).toHaveCount(0);
});

test('keeps a sourced trend readable when its publisher photo fails and no ingredient can be ordered', async ({ page }) => {
  const trend = dailyFixture.trends[0];
  const imageUrl = 'https://food.example/trend-photo.jpg';
  await page.route(imageUrl, (route) => route.abort());
  await page.route('**/market-today-fixture/snapshot', (route) => route.fulfill({
    json: {
      ...dailyFixture,
      trends: [{ ...trend, image_key: imageUrl, ingredients: trend.ingredients.map((ingredient) => ({
        ...ingredient, listings: ingredient.listings.map((listing) => ({ ...listing, stock_kg: 0 })),
      })) }],
    },
  }));
  await page.goto('/tests/fixtures/market-today.html');
  const article = page.getByRole('article', { name: trend.name });
  await expect(article.getByRole('link', { name: 'Dessert menu report' })).toBeVisible();
  await expect(article.locator('img')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Recommended ingredients' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Order Ingredients' })).toHaveCount(0);
});

test('opens a cited social post on request when no dish photo is available', async ({ page }) => {
  const source = { title: 'Bangkok bakery reel', url: 'https://www.instagram.com/reel/Bakery01/' };
  const trend = { ...dailyFixture.trends[0], image_key: null, sources: [source] };
  await page.route('**/market-today-fixture/snapshot', (route) => route.fulfill({ json: { ...dailyFixture, trends: [trend] } }));
  await page.route('https://www.instagram.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<p>Source preview</p>' }));
  await page.goto('/tests/fixtures/market-today.html');
  await expect(page.getByRole('link', { name: source.title })).toHaveAttribute('href', source.url);
  await expect(page.locator('.market-social-preview iframe')).toHaveCount(0);
  await page.getByRole('button', { name: 'View Instagram post' }).click();
  await expect(page.locator('.market-social-preview iframe')).toHaveAttribute('src', source.url + 'embed/');
  await page.getByRole('button', { name: 'Close preview' }).click();
  await expect(page.locator('.market-social-preview iframe')).toHaveCount(0);
});

test('switches among the top three inside the same trend card', async ({ page }) => {
  await page.route('**/market-today-fixture/snapshot', route => route.fulfill({ json: dailyFixture }));
  await page.goto('/tests/fixtures/market-today.html');
  const choices = page.getByRole('group', { name: 'Ranked trends' });
  await expect(choices.getByRole('button')).toHaveCount(3);
  await choices.getByRole('button', { name: 'Mango Smoothie' }).click();
  const selected = page.getByRole('article', { name: 'Mango Smoothie' });
  await expect(selected.getByRole('heading', { name: 'Mango Smoothie' })).toBeVisible();
  await expect(selected.getByRole('group').getByRole('button', { name: 'Mango Smoothie' })).toHaveAttribute('aria-pressed', 'true');
});
