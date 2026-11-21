import { expect, test } from '@playwright/test';

test('a buyer can skip an expensive trial or request an affordable delivered lot', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-21T03:00:00Z'));
  await page.addInitScript(() => localStorage.setItem('maract.idea-a.locale', 'en'));
  await page.goto('/ideas/idea-a');
  const plan = page.locator('.market-trial');
  await plan.getByRole('combobox', { name: 'Ingredient', exact: true }).selectOption('milk');
  await plan.getByLabel('Trial kg').fill('2');
  await plan.getByLabel('Budget (฿)').fill('100');
  await expect(plan.getByText('Over budget', { exact: true })).toBeVisible();
  await expect(plan.getByRole('button', { name: 'Request a quote' })).toHaveCount(0);
  await plan.getByLabel('Budget (฿)').fill('500');
  await plan.getByRole('button', { name: 'Request a quote' }).click();
  await expect(plan.getByText('Quote request in supplier inbox')).toBeVisible();
  await page.getByRole('button', { name: 'View as seller' }).click();
  await page.getByRole('combobox', { name: 'Supplier', exact: true }).selectOption('thaidairy');
  await expect(page.getByText(/Milk 2 kg/)).toBeVisible();
});
