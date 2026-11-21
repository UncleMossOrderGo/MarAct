import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

test('grower signs in to the same farm again and a second account has its own farm', async ({ page, browser }) => {
  const accounts = ['สวนแรก-' + randomUUID(), 'สวนสอง-' + randomUUID()];
  const password = randomUUID();
  const second = await browser.newContext({ baseURL:test.info().project.use.baseURL });
  try {
    for (const [index, user] of [page, await second.newPage()].entries()) {
      await user.goto('/ideas/idea-d');
      await expect(user).toHaveURL('/login');
      await user.getByRole('button', {name:'สร้างบัญชีสวน'}).click();
      await user.getByLabel('ชื่อบัญชีสวน').fill(accounts[index]);
      await user.getByLabel('รหัสผ่าน').fill(password);
      await user.getByRole('button',{name:'สร้างบัญชีสวน',exact:true}).click();
      await expect(user.getByRole('heading',{name:accounts[index]})).toBeVisible();
    }
    await page.getByRole('button',{name:'ออกจากระบบ'}).click();
    await expect(page).toHaveURL('/login');
    await page.getByLabel('ชื่อบัญชีสวน').fill(accounts[0]);
    await page.getByLabel('รหัสผ่าน').fill('wrong-password');
    await page.getByRole('button',{name:'เข้าสู่ระบบสวน'}).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await page.getByLabel('รหัสผ่าน').fill(password);
    await page.getByRole('button',{name:'เข้าสู่ระบบสวน'}).click();
    await expect(page.getByRole('heading',{name:accounts[0]})).toBeVisible();
    await page.getByRole('button', { name: 'ลงขายกับผู้ช่วย' }).click();
    await expect(page.getByRole('heading', { name: 'ตรวจสอบก่อนลงขาย' })).toBeVisible();
  } finally {await second.close();}
});
