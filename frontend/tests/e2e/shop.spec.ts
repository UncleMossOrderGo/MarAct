import { expect, test } from '@playwright/test';

test('recovers from a failed shop load and opens Bakery without sign-in', async ({ page }) => {
  const shop = { id: 'bakery-main', name: 'MarAct Bakery', category: 'bakery' };
  let calls = 0;
  await page.route('**/api/shop/shops', (route) => {
    if (++calls === 1) return route.fulfill({ status: 503 });
    return route.fulfill({ json: { shops: [shop], default_shop_id: shop.id } });
  });
  await page.route('**/api/shop/shops/bakery-main/today?locale=th', (route) =>
    route.fulfill({ json: { shop, run: null, trends: [] } }));
  await page.route('**/api/shop/jobs/daily-trend/latest', (route) =>
    route.fulfill({ json: { attempt: null, latest_usable: null, demo_enabled: false } }));

  await page.goto('/ideas/idea-a');
  await expect(page.getByRole('alert')).toHaveText('โหลดข้อมูลไม่สำเร็จ');
  await page.getByRole('button', { name: 'ลองอีกครั้ง' }).click();
  await expect(page.getByRole('heading', { name: 'เทรนด์วันนี้' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'ร้านที่ใช้งาน' })).toHaveCount(0);
  await expect(page.locator('.market-store-name')).toHaveText(shop.name);
  await expect(page.getByRole('button', { name: 'รันงานประจำวัน' })).toBeDisabled();
});

test('trend trial carries the selected ingredient and delivery limits into the farm catalog', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('maract.idea-a.locale', 'en'));
  const shop = { id: 'bakery-main', name: 'MarAct Bakery', category: 'bakery' };
  const ingredient = { name: 'Mango', name_th: 'มะม่วง', ingredient_id: 'mango', suggested_kg: 2, listings: [] };
  const trend = {
    slug: 'mango-soda', name: 'Mango soda', kind: 'drink', momentum: 'rising', is_new: true,
    sources: [], ingredients: [ingredient], why_rising: '', why_fit: '', menu_idea: '', image_key: null,
  };
  await page.route('**/api/shop/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = path.endsWith('/today') ? { shop, run: null, trends: [trend] }
      : path.endsWith('/shops') ? { shops: [shop], default_shop_id: shop.id }
      : path.endsWith('/latest') ? { demo_enabled: false } : [];
    await route.fulfill({ json });
  });
  await page.route('**/api/ideas/idea-c/lots?**', async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const matches = params.get('q') === ingredient.name_th;
    await route.fulfill({ json: matches ? [{
      id: 'mango-orchard', name: 'มะม่วงน้ำดอกไม้', farm: 'สวนทดสอบ', kg: 1, unit: 'กก.',
      price: 50, minimum: 1, stock: 10, freight: 20, earliest: params.get('arrival'),
      units: 2, total: 120, requested_kg: 2, misses: [], preferred: false,
    }] : [] });
  });
  await page.goto('/market/shop');
  await page.getByLabel('Trial kg').fill('2');
  await page.getByLabel('Delivery postcode').fill('10100');
  const comparison = page.locator('.market-farm-trial');
  await expect(comparison.getByText(/มะม่วงน้ำดอกไม้ · สวนทดสอบ/)).toBeVisible();
  await comparison.getByRole('link').click();
  await expect(page.getByRole('searchbox')).toHaveValue('มะม่วง');
  await expect(page.getByLabel('จำนวนที่ต้องการ (กก.)')).toHaveValue('2');
  await expect(page.getByRole('article').filter({ hasText: 'สวนทดสอบ' })).toBeVisible();
  await page.getByLabel('งบรวมค่าส่ง (บาท)').fill('100');
  await expect(page.getByText('ยอดรวมเกินงบที่ตั้งไว้')).toBeVisible();
});
