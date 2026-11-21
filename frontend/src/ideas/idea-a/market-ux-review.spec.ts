import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { installDailyUxFixture } from '../../../tests/fixtures/daily-ux-fixture';

test.skip(process.env.MARACT_UX_REVIEW !== '1', 'Run once the daily marketplace is wired into /ideas/idea-a.');

async function capture(page: Page, testInfo: TestInfo, panel: string, fullPage = true) {
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const path = testInfo.outputPath(`${panel}.png`);
  await page.screenshot({ path, fullPage, animations: 'disabled' });
  await testInfo.attach(panel, { path, contentType: 'image/png' });
}

function nav(page: Page, name: RegExp) {
  return page.getByRole('navigation').getByRole('button', { name });
}

async function english(page: Page) {
  await nav(page, /ตั้งค่า|settings/i).click();
  await page.getByRole('combobox', { name: /^(ภาษา|language)$/i }).selectOption('en');
  await nav(page, /วันนี้|today/i).click();
  await expect(page.getByText('Pistachio Gelato', { exact: true }).first()).toBeVisible();
}

test('reviews 1440px Bakery, catalog, orders, settings and daily refresh', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installDailyUxFixture(page);
  await page.goto('/ideas/idea-a');
  await expect(page.getByText('เจลาโตพิสตาชิโอ', { exact: true }).first()).toBeVisible();
  await capture(page, testInfo, 'desktop-today-th');
  await english(page);
  const run = page.getByRole('button', { name: /run daily job/i });
  await run.focus();
  await expect(run).toBeFocused();
  await capture(page, testInfo, 'desktop-today-en');
  await run.press('Enter');
  await expect(page.getByText('Pistachio Gelato', { exact: true }).first()).toBeVisible();
  await capture(page, testInfo, 'desktop-refresh');
  await expect(page.getByRole('status').filter({ hasText: 'Trends updated.' })).toBeVisible();
  await nav(page, /marketplace/i).click();
  await expect(page.getByText('Pistachio Paste', { exact: true }).first()).toBeVisible();
  await capture(page, testInfo, 'desktop-marketplace');
  await nav(page, /orders/i).click();
  await expect(page.getByText(/5,495\.00/).first()).toBeVisible();
  await capture(page, testInfo, 'desktop-orders');
  await nav(page, /settings/i).click();
  await expect(page.getByRole('combobox', { name: 'Language' })).toHaveValue('en');
  await capture(page, testInfo, 'desktop-settings');
});

test('reviews the 390px trend-to-order path and 360px overflow', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const fixture = await installDailyUxFixture(page);
  const release = fixture.delayToday();
  await page.goto('/ideas/idea-a');
  await expect(page.getByRole('status', { name: /กำลังโหลด|loading/i }).first()).toBeVisible();
  await capture(page, testInfo, 'mobile-skeleton');
  release();
  await expect(page.getByText('เจลาโตพิสตาชิโอ', { exact: true }).first()).toBeVisible();
  await capture(page, testInfo, 'mobile-today-th');
  const releaseReload = fixture.delayToday();
  await page.reload();
  await expect(page.getByRole('status', { name: /กำลังโหลด|loading/i }).first()).toBeVisible();
  await capture(page, testInfo, 'mobile-reload-skeleton');
  releaseReload();
  await expect(page.getByText('เจลาโตพิสตาชิโอ', { exact: true }).first()).toBeVisible();
  await page.setViewportSize({ width: 360, height: 800 });
  await capture(page, testInfo, 'mobile-today-th-360');
  await page.setViewportSize({ width: 390, height: 844 });
  await english(page);
  await page.getByText('Pistachio Gelato', { exact: true }).first().click();
  await capture(page, testInfo, 'mobile-trend-detail');
  await page.getByRole('tab', { name: 'Ingredients' }).click();
  await expect(page.getByText('Kataifi topping', { exact: true }).first()).toBeVisible();
  await capture(page, testInfo, 'mobile-ingredients');
  await page.getByRole('button', { name: /add all/i }).click();
  await page.getByRole('button', { name: /cart/i }).first().click();
  const cart = page.getByRole('dialog', { name: /your cart/i });
  const increase = cart.getByRole('button', { name: /^increase pistachio paste/i });
  for (let step = 0; step < 3; step++) await increase.click();
  await expect(cart.getByText(/5,495\.00/)).toBeVisible();
  const checkout = cart.getByRole('button', { name: /continue to checkout/i });
  await expect(checkout).toBeInViewport();
  await capture(page, testInfo, 'mobile-cart', false);
  await checkout.click();
  await capture(page, testInfo, 'mobile-checkout');
  fixture.failCheckout(true);
  await page.getByRole('button', { name: 'Place order', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Only 4 kg remain');
  await capture(page, testInfo, 'mobile-checkout-error');
  fixture.failCheckout(false);
  await page.getByRole('button', { name: 'Place order', exact: true }).click();
  await expect(page.getByText(/5,495\.00/).first()).toBeVisible();
  await capture(page, testInfo, 'mobile-order-placed');
  await page.setViewportSize({ width: 360, height: 800 });
  await capture(page, testInfo, 'mobile-order-placed-360');
});

test('reviews failed first load and retry at 360px', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const fixture = await installDailyUxFixture(page);
  fixture.failToday(true);
  await page.goto('/ideas/idea-a');
  await expect(page.getByRole('alert').first()).toBeVisible();
  await capture(page, testInfo, 'mobile-today-error');
  fixture.failToday(false);
  await page.getByRole('button', { name: /ลองอีกครั้ง|retry/i }).first().click();
  await expect(page.getByText('เจลาโตพิสตาชิโอ', { exact: true }).first()).toBeVisible();
  fixture.emptyToday();
  await page.reload();
  await expect(page.getByText('ยังไม่มีเทรนด์ที่เผยแพร่')).toBeVisible();
  await capture(page, testInfo, 'mobile-today-empty');
});
