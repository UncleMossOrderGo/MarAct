import { expect, test } from '@playwright/test';

test('recovers from a failed shop load and opens Bakery without sign-in', async ({ page }) => {
  const shop = { id: 'bakery-main', name: 'MarAct Bakery', category: 'bakery' };
  let calls = 0;
  await page.route('**/api/ideas/idea-a/shops', (route) => {
    if (++calls === 1) return route.fulfill({ status: 503 });
    return route.fulfill({ json: { shops: [shop], default_shop_id: shop.id } });
  });
  await page.route('**/api/ideas/idea-a/shops/bakery-main/today?locale=th', (route) =>
    route.fulfill({ json: { shop, run: null, trends: [] } }));
  await page.route('**/api/ideas/idea-a/jobs/daily-trend/latest', (route) =>
    route.fulfill({ json: { attempt: null, latest_usable: null, demo_enabled: false } }));

  await page.goto('/ideas/idea-a');
  await expect(page.getByRole('alert')).toHaveText('โหลดข้อมูลไม่สำเร็จ');
  await page.getByRole('button', { name: 'ลองอีกครั้ง' }).click();
  await expect(page.getByRole('heading', { name: 'เทรนด์วันนี้' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'ร้านที่ใช้งาน' })).toHaveCount(0);
  await expect(page.locator('.market-store-name')).toHaveText(shop.name);
  await expect(page.getByRole('button', { name: 'รันงานประจำวัน' })).toBeDisabled();
});
