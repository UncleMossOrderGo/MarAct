import { expect, test } from '@playwright/test';

test('loads demo photos and the fallback, and persists language with long names', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/tests/fixtures/market-ingredient-assets.html');
  await expect(page.getByRole('heading', { name: 'เทรนด์วันนี้' })).toBeVisible();
  const images = page.getByRole('img');
  await expect(images).toHaveCount(35);
  const fallback = /fallback\.svg|^data:image\/svg\+xml/;
  await expect(page.getByRole('img', { name: 'unknown' })).toHaveAttribute('src', fallback);
  expect((await images.evaluateAll((elements) => elements.map((element) => (element as HTMLImageElement).src)))
    .filter((src) => fallback.test(src))).toHaveLength(1);
  await expect.poll(() => images.evaluateAll((elements) =>
    elements.every((element) => (element as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await expect(page.getByRole('img', { name: 'butter', exact: true })).toHaveAttribute('src', /unsalted-butter\.webp$/);

  await page.getByRole('combobox', { name: 'ภาษา' }).selectOption('en');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Today’s Trends' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
});
