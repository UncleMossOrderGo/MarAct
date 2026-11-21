import { expect, test } from '@playwright/test';
import { nextSaturday } from '../../src/features/marketplace/weekend-trial';

test('Wednesday in Bangkok targets the upcoming Saturday', () => {
  expect(nextSaturday(new Date('2026-11-24T20:00:00Z'))).toBe('2026-11-28');
});

test('a café finds one deliverable trial inside ฿500 and reviews the same lot in its cart', async ({ page }) => {
  // Other journeys publish their own lots concurrently. Compare only the stable catalog fixtures.
  await page.route('**/api/ideas/idea-c/lots?**', async route => {
    const response = await route.fetch();
    const lots = await response.json() as { is_sample: boolean }[];
    await route.fulfill({ response, json: lots.filter(lot => lot.is_sample) });
  });
  await page.goto('/market');
  await expect(page.getByRole('navigation', { name: 'Marketplace' }).getByRole('button')).toHaveCount(3);
  const plan = page.locator('.weekend-trial');
  await expect(plan.getByLabel('งบรวมค่าส่ง (บาท)')).toHaveValue('500');
  const deliveryDay = new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10);
  await plan.getByLabel('วันที่ต้องการรับ').fill(deliveryDay);
  await expect(plan.locator('.trial-pick')).toContainText('สวนริมคลอง');
  await expect(plan.locator('.trial-pick')).toContainText('฿240');
  await plan.getByLabel('งบรวมค่าส่ง (บาท)').fill('200');
  await expect(plan.getByRole('status')).toContainText('ยังไม่มีล็อต');
  await plan.getByLabel('งบรวมค่าส่ง (บาท)').fill('500');
  await plan.getByLabel('รหัสไปรษณีย์').fill('90000');
  await expect(plan.getByRole('status')).toContainText('ยังไม่มีล็อต');
  await plan.getByLabel('รหัสไปรษณีย์').fill('10100');
  await plan.getByRole('button', { name: 'ตรวจรายการและจองล็อตนี้' }).click();
  await expect(page).toHaveURL('/market#cart');
  await expect(page.locator('.cart-line').first()).toContainText('มะม่วงน้ำดอกไม้');
  await page.unrouteAll({ behavior: 'wait' });
});

test('saved trends open the shop assistant from the buyer home', async ({ page }) => {
  await page.goto('/market');
  const trends = page.getByRole('region', { name: 'เทรนด์วันนี้สำหรับร้าน' });
  await expect(trends.getByRole('article').first()).toBeVisible();
  await expect(trends.getByRole('button', { name: 'ค้นหาเทรนด์ใหม่' })).toBeVisible();
  await trends.getByRole('button', { name: 'ถาม AI เรื่องเทรนด์นี้' }).first().click();
  await expect(page.getByRole('dialog', { name: 'ผู้ช่วย MarAct' })).toBeVisible();
  await page.getByRole('button', { name: 'ปิดผู้ช่วย' }).click();
  await expect(page).toHaveURL('/market');
});
