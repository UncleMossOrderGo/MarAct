import { expect, test } from '@playwright/test';
import { installDailyUxFixture } from '../../../tests/fixtures/daily-ux-fixture';

test('owner counts inventory, reviews a seven-day shortage and opens its basket', async ({ page }) => {
  await installDailyUxFixture(page);
  await page.addInitScript(() => localStorage.setItem('maract.idea-a.locale', 'en'));
  const milk = { ingredient_id: 'milk', name_en: 'Milk', name_th: 'นม', kg_on_hand: '5',
    usage_7d_kg: '7', reorder_kg: 2, days_of_cover: '5' };
  await page.route('**/api/shop/shops/bakery-main/stock', async route => {
    if (route.request().method() === 'PUT') {
      const { ingredient_id, kg_on_hand } = route.request().postDataJSON();
      expect(ingredient_id).toBe('milk');
      milk.kg_on_hand = String(kg_on_hand);
      milk.days_of_cover = String(kg_on_hand);
      milk.reorder_kg = Math.max(0, 7 - Number(kg_on_hand));
      return route.fulfill({ json: milk });
    }
    return route.fulfill({ json: { items: [milk, { ...milk, ingredient_id: 'flour', name_en: 'Flour',
      kg_on_hand: null, reorder_kg: null, days_of_cover: null }] } });
  });
  await page.goto('/ideas/idea-a');
  await page.getByRole('navigation').getByRole('button', { name: 'Shop stock' }).click();
  await expect(page.getByRole('heading', { name: 'Stock dashboard' })).toBeVisible();
  await page.getByRole('button', { name: 'Need a count', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit count · Flour' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit count · Milk' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Below 7 days', exact: true }).click();
  await page.getByRole('button', { name: 'Edit count · Milk' }).click();
  await page.getByLabel('Count in kg').fill('3');
  await page.getByRole('button', { name: 'Save count' }).click();
  const topUp = page.getByRole('button', { name: /Add top-up to basket/ });
  await expect(topUp).toContainText('168.00');
  await topUp.click();
  const basket = page.getByRole('dialog', { name: /Your cart/i });
  await expect(basket).toBeVisible();
  await expect(basket.getByText('4 kg', { exact: true })).toBeVisible();
  await basket.getByRole('button', { name: /close/i }).click();
  await expect(topUp).toHaveCount(0);
});
