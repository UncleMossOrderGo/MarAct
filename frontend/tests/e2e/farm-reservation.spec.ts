import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

test('a grower publishes a fresh lot and accepts the buyer’s reservation', async ({ page: grower, browser, baseURL }) => {
  const suffix = randomUUID().slice(0, 8);
  const fruit = 'สับปะรด-' + suffix;
  const shop = 'คาเฟ่-' + suffix;
  const date = (offset: number) => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(Date.now() + offset * 86400000));

  await grower.goto('/market/farm');
  await grower.getByRole('button', { name: 'ผู้ช่วยลงขาย', exact: true }).click();
  await grower.getByRole('button', { name: 'กรอกเอง' }).click();
  await grower.getByLabel('ชื่อผลไม้ / พันธุ์').fill(fruit);
  await grower.getByLabel('ปริมาณพร้อมขาย (กก.)').fill('20');
  await grower.getByLabel('ราคาขาย (บาท)').fill('50');
  await grower.getByLabel('หน่วยขาย เช่น กก. หรือลัง').fill('กก.');
  await grower.getByLabel('ขั้นต่ำต่อคำสั่งซื้อ (กก.)').fill('3');
  await grower.getByLabel('เริ่มส่งได้วันที่').fill(date(0));
  await grower.getByLabel('พื้นที่จัดส่ง', { exact: true }).fill('กรุงเทพฯ');
  await grower.getByRole('button', { name: 'บันทึกร่างจากแบบฟอร์ม' }).click();
  const photo = fileURLToPath(new URL('../../src/features/shop/marketplace-photos/pineapple.webp', import.meta.url));
  await grower.getByLabel('เลือกรูปจากเครื่อง').setInputFiles(photo);
  await expect(grower.getByRole('img', { name: 'รูปปกที่จะเผยแพร่' })).toBeVisible();
  await grower.getByRole('button', { name: 'ยืนยันลงขาย' }).click();
  await expect(grower.getByRole('heading', { name: fruit })).toBeVisible();

  const buyerContext = await browser.newContext({ baseURL });
  try {
    const buyer = await buyerContext.newPage();
    const query = new URLSearchParams({ q: fruit, kg: '5', postcode: '10100', arrival: date(2) });
    await buyer.goto('/market?' + query);
    const lot = buyer.getByRole('article').filter({ has: buyer.getByRole('heading', { name: fruit, exact: true }) });
    await expect(lot).toContainText('310 บาท');
    const cover = lot.locator('img[src^="/api/farmer/marketplace/photos/"]');
    await expect(cover).toBeVisible();
    await expect.poll(() => cover.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await lot.getByRole('button', { name: 'เพิ่มลงตะกร้า' }).click();
    await buyer.getByRole('button', { name: 'ตะกร้า (1)' }).click();
    await buyer.getByRole('button', { name: 'ระบุข้อมูลเพื่อจอง' }).click();
    await buyer.getByLabel('ชื่อร้าน').fill(shop);
    await buyer.getByLabel('รหัสผ่าน').fill(randomUUID());
    await buyer.getByRole('button', { name: 'สร้างบัญชีร้าน' }).click();
    await buyer.getByLabel('ที่อยู่จัดส่ง').fill('คาเฟ่ ย่านเยาวราช');
    await buyer.getByRole('button', { name: 'ตรวจยอดและรอบส่ง' }).click();
    await buyer.getByRole('button', { name: 'ยืนยันคำสั่งซื้อ' }).click();
    const buyerOrder = buyer.getByRole('article').filter({ hasText: fruit });
    await expect(buyerOrder).toContainText('รอสวนยืนยัน');
    await expect(buyerOrder).toContainText('310 บาท');

    await grower.getByRole('button', { name: 'จัดการสวน', exact: true }).click();
    const reservation = grower.getByRole('article').filter({ hasText: shop });
    await expect(reservation).toContainText(fruit + ' · 5 กก.');
    await reservation.getByRole('button', { name: 'รับคำสั่งซื้อ' }).click();
    await reservation.getByLabel('วิธีชำระเงินสำหรับผู้ซื้อ').fill('ชำระเมื่อรับสินค้า');
    await reservation.getByRole('button', { name: 'ส่งคำยืนยันให้ผู้ซื้อ' }).click();
    await expect(reservation.getByText('ยืนยันแล้ว', { exact: true })).toBeVisible();
    await buyer.getByRole('button', { name: 'อัปเดตสถานะ' }).click();
    await expect(buyerOrder).toContainText('สวนยืนยันแล้ว');
    await expect(buyerOrder).toContainText('ชำระเมื่อรับสินค้า');
  } finally {
    await buyerContext.close();
  }
});
