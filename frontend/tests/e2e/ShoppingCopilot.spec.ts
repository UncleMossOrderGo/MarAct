import { expect, test } from '@playwright/test';

test('Idea B starts in chat and displays the tool trace under its reply', async ({ page }) => {
  await page.route(/\/copilot\/chat\?/, (route) => route.fulfill({ json: {
    message: 'ลองเปรียบเทียบฟาร์ม', products: [], suggested_cart: null,
    trend_opportunities: [{
      fruit_id: 'mango', fruit_name: 'มะม่วง', source_name: 'ข้อมูลเดโม', observation_window: '2026-11-09 / 2026-11-15',
      buyer_fit_reasons: [], caveat: 'สัญญาณเดโม',
      market_context: { status: 'available', summary: 'มีรายงานตลาด [รายงาน](https://example.org/report)',
        citations: [{ title: 'รายงานตลาด', url: 'https://example.org/report' }] },
    }],
    assumptions: [], warnings: [], source: 'openai', conversation_id: 'chat-demo', search_context: null,
    tool_calls: [{ name: 'search_listings', status: 'completed' }],
  } }));
  await page.setViewportSize({ width: 375, height: 844 });
  await page.goto('/ideas/idea-b/chat');
  await expect(page.getByRole('heading', { name: 'ผู้ช่วยจัดซื้อผลไม้' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'เปรียบเทียบฟาร์ม' })).toHaveCount(0);
  await page.getByRole('button', { name: 'หามะม่วง 50 กก. ราคาถูกที่สุด' }).click();
  await page.getByLabel('ข้อความถึงผู้ช่วยจัดซื้อ').press('Enter');
  await expect(page.getByRole('log').getByText('search_listings')).toBeVisible();
  await expect(page.getByRole('log').getByText('สำเร็จ', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '[1]', exact: true })).toHaveAttribute('href', 'https://example.org/report');
  await expect(page.getByRole('button', { name: 'ค้นข่าวผ่าน MCP' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  const main = await page.locator('main').boundingBox();
  expect(main?.x).toBe(0);
  expect(main?.width).toBe(375);
  const composer = await page.locator('.copilot-chat__footer').boundingBox();
  expect(composer && composer.y + composer.height).toBeCloseTo(844, 0);
});

test('buyer ranks demo listings and explicitly accepts a trend trial preview', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 844 });
  await page.goto('/ideas/idea-b/workspace');
  const copilot = page.getByRole('region', { name: 'ผู้ช่วยจัดซื้อผลไม้' });
  await expect(copilot.getByLabel('ถามผู้ช่วยจัดซื้อ')).toBeVisible();
  await expect(copilot.getByLabel('ค้นหาผลไม้')).toBeHidden();
  await copilot.getByText('ค้นหาและกรองเอง', { exact: true }).click();
  await copilot.getByLabel('ค้นหาผลไม้').fill('มะม่วงน้ำดอกไม้');
  await copilot.getByLabel('ปริมาณที่ต้องการ (กก.)').fill('50');
  await copilot.getByRole('button', { name: 'ค้นหาจากแคตตาล็อก' }).click();
  await expect(copilot.getByRole('article').first()).toContainText('สวนผลไม้จันทบุรี');
  await copilot.getByLabel('เรียงสินค้า').selectOption('lowest_product_price');
  await copilot.getByRole('button', { name: 'ค้นหาจากแคตตาล็อก' }).click();
  await expect(copilot.getByRole('article').first()).toContainText('สวนมะม่วงซันไรส์');
  await copilot.getByText('แนวโน้มที่เหมาะกับร้าน', { exact: true }).click();
  await copilot.getByRole('button', { name: 'โหลดโอกาสจากแนวโน้ม' }).click();
  await expect(copilot.getByText(/สัญญาณเดโมไม่ทำนายยอดขาย/).first()).toBeVisible();
  await copilot.getByLabel('ปริมาณทดลองสั่ง (กก.)').fill('50');
  await copilot.getByRole('button', { name: 'ดูตัวอย่างตะกร้าทดลอง' }).first().click();
  await expect(copilot.getByRole('heading', { name: 'ตัวอย่างตะกร้า' })).toBeVisible();
  await expect(copilot.getByText('ยืนยันตัวอย่างบนหน้านี้แล้ว')).toHaveCount(0);
  await copilot.getByRole('button', { name: 'ยืนยันตัวอย่างตะกร้า' }).click();
  await expect(copilot.getByText('ยืนยันตัวอย่างบนหน้านี้แล้ว')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});
