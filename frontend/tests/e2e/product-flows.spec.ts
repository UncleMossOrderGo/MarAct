import { expect, test } from '@playwright/test';

test('trend selection reaches both catalog search and an editable buyer brief', async ({ page }) => {
  await page.goto('/market');
  await page.getByRole('link', {name:'ดูเทรนด์', exact:true}).click();
  await page.getByRole('button', {name:'สับปะรด'}).click();
  await expect(page.getByRole('table')).toBeVisible();
  await page.getByRole('link', {name:'ค้นหาสับปะรดในตลาด'}).click();
  await expect(page.getByRole('searchbox')).toHaveValue('สับปะรด');
  await page.reload();
  await expect(page.getByRole('searchbox')).toHaveValue('สับปะรด');
  await page.goBack();
  await page.getByRole('link', {name:'ถามผู้ช่วยเรื่องสับปะรด'}).click();
  await expect(page.getByRole('dialog').getByLabel('ข้อความถึงผู้ช่วย')).toHaveValue(/สับปะรด/);
});

test('market navigation and public farm failure are usable on narrow screens', async ({ page }) => {
  await page.setViewportSize({width:320,height:780});
  await page.route('**/api/ideas/idea-d/marketplace', route => route.fulfill({ status:503, body:'offline' }));
  await page.goto('/market');
  await expect(page.getByRole('alert').filter({hasText:'โหลดประกาศจากสวนไม่ได้'})).toBeVisible();
  await page.unroute('**/api/ideas/idea-d/marketplace');
  await page.getByRole('button',{name:'ลองอีกครั้ง'}).click();
  await expect(page.locator('.farm-tile').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('link',{name:'สวนของฉัน'}).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading',{name:'เข้าสู่ระบบสวน'})).toBeVisible();
});

test('buyer chat retains the conversation and draft when minimized', async ({ page }) => {
  await page.route('**/copilot/chat', route => route.fulfill({json: {
    message: 'พบล็อตมะม่วงสำหรับร้าน', source: 'deterministic', lots: [], groups: [], trends: [],
    tool_calls: [], unfulfilled: [], previous: {query: 'มะม่วง', kg: 20}, delivery_confirmed: false,
  }}));
  await page.goto('/market#orders');
  const button = page.getByRole('button', {name:'ผู้ช่วยจัดซื้อ AI · ถาม AI'});
  await button.focus();
  await page.keyboard.press('Enter');
  const chat = page.getByRole('dialog');
  const input = chat.getByLabel('ข้อความถึงผู้ช่วย');
  await expect(input).toBeFocused();
  await input.fill('อยากได้มะม่วง 20 กก.');
  await input.press('Enter');
  await expect(chat.getByText('พบล็อตมะม่วงสำหรับร้าน')).toBeVisible();
  await input.fill('ขอเทียบราคา');
  await input.press('Escape');
  await expect(chat).toHaveCount(0);
  await expect(button).toBeFocused();
  await button.click();
  await expect(input).toHaveValue('ขอเทียบราคา');
  await expect(chat.getByText('อยากได้มะม่วง 20 กก.')).toBeVisible();
  await chat.getByRole('button', {name:'ย่อแชต'}).click();
  await expect(page).toHaveURL('/market#orders');
});

test('shop order samples can be inspected before login without order actions', async ({page}) => {
  await page.setViewportSize({width: 320, height: 740});
  await page.goto('/market#orders');
  await expect(page.getByRole('heading', {name:'ตัวอย่างคำสั่งซื้อ'})).toBeVisible();
  const sample = page.getByRole('article').filter({hasText:'DEMO-001'});
  await sample.getByText('รายละเอียดคำสั่งซื้อ').click();
  await expect(sample.getByText('ค่าสินค้า ฿900 · ค่าจัดส่ง ฿80')).toBeVisible();
  await expect(sample.getByRole('button')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('link', {name:'เข้าสู่บัญชีร้าน'}).click();
  await expect(page.getByLabel('ชื่อร้าน')).toBeFocused();
});

test('a fruit in the farm name does not match unrelated published lots', async ({ page }) => {
  const farmName = 'สวนมะม่วงทดสอบ MarAct';
  const listing = (id: string, fruit: string, area: string) => ({
    id, available: true, cover: 0, photos: [],
    fields: { fruit, area, stock_kg: 48, price: 45, unit: 'กก.', kg_per_unit: 1, min_kg: 1, ready: null },
  });
  await page.route('**/api/ideas/idea-d/marketplace', route => route.fulfill({json: [{
    farmId: 2, profile: {name: farmName, location: '', about: '', area: ''},
    listings: [listing('rose', 'ชมพู่ทับทิมจันทร์', 'นนทบุรี'), listing('mango', 'มะม่วงน้ำดอกไม้', 'กรุงเทพฯ')],
  }]}));
  await page.goto('/market?' + new URLSearchParams({q:'มะม่วง'}));
  const cards = page.locator('.farm-tile');
  await expect(cards).toHaveCount(1);
  await expect(cards.first().getByRole('heading')).toHaveText('มะม่วงน้ำดอกไม้');
  await page.getByRole('link', {name:'ดูประกาศทั้งหมด'}).click();
  const results = page.locator('article h2');
  await expect(results).toHaveText(['มะม่วงน้ำดอกไม้']);
  const search = page.getByRole('searchbox');
  await search.fill('นนทบุรี');
  await expect(results).toHaveText(['ชมพู่ทับทิมจันทร์']);
  await search.fill(farmName.toLowerCase());
  await expect(results).toHaveCount(2);
  await search.fill('');
  await page.getByRole('combobox', {name:'เลือกสวน'}).selectOption('2');
  await expect(results).toHaveCount(2);
});
