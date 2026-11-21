import { expect, test } from '@playwright/test';

test('a grower can open LINE pairing and return to the shared farm catalog', async ({ page }) => {
  await page.goto('/market/farm');
  await page.getByRole('button', { name: 'จัดการสวน', exact: true }).click();
  await page.getByRole('button', { name: 'สร้างรหัสเชื่อม LINE' }).click();
  await expect(page.getByLabel('ส่งข้อความนี้ในแชตส่วนตัวกับ LINE OA ภายใน 10 นาที')).toHaveValue(/^เชื่อมสวน .+/);
  await page.getByRole('button', { name: 'โปรไฟล์สวน', exact: true }).click();
  await page.getByRole('link', { name: 'ดูประกาศในตลาดผลไม้' }).click();
  await expect(page).toHaveURL(/\/market\?q=.+/);
  await expect(page.getByRole('button', { name: 'ผู้ช่วยจัดซื้อ' })).toBeVisible();
});
