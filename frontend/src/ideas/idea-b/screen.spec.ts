import { expect, test } from '@playwright/test';

test('Idea B displays its own records and selected idea', async ({ page }) => {
  await page.route('**/api/ideas/idea-b/records', (route) =>
    route.fulfill({ json: [{ id: 1, title: 'Idea B fixture' }] }),
  );
  await page.goto('/ideas/idea-b');
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByRole('heading', { name: 'Fruit procurement' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Idea' })).toHaveValue('idea-b');
  await expect(page.getByText('Idea B fixture', { exact: true })).toBeVisible();
  const compareLink = page.getByRole('link', { name: 'Compare suppliers' });
  await compareLink.focus();
  await compareLink.press('Enter');
  await expect(page.getByRole('heading', { name: 'Compare fruit suppliers' })).toBeFocused();
});

test('buyer compares farms, changes priorities and checks interest for the selected fruit', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 844 });
  await page.goto('/ideas/idea-b');
  await page.getByRole('button', { name: 'English' }).click();
  const suppliers = page.getByRole('region', { name: 'Compare fruit suppliers' });
  const trends = page.getByRole('region', { name: 'Fruit trend intelligence' });
  await expect(trends.getByText('Rising interest', { exact: true })).toBeVisible();
  await expect(trends.getByText('9 Nov 2026', { exact: true })).toBeVisible();
  await expect(trends.getByRole('row', { name: /Social mentions.*140.*185/ })).toBeVisible();

  await suppliers.getByRole('button', { name: 'Compare suppliers' }).click();
  await expect(suppliers.getByRole('article')).toHaveCount(3);
  await expect(suppliers.getByRole('article').first()).toContainText('Sunrise Mango Farm');
  await expect(suppliers.getByText('Familiar supplier', { exact: true })).toBeVisible();
  await expect(suppliers.getByText('Shipping is unknown.', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

  const price = suppliers.getByRole('spinbutton', { name: 'Price', exact: true });
  await expect(price).toBeHidden();
  const priorities = suppliers.getByText('Ranking priorities', { exact: true });
  await priorities.focus();
  await priorities.press('Enter');
  await price.fill('0');
  await expect(suppliers.getByRole('status')).toContainText('Compare again to refresh these matches');
  await suppliers.getByRole('button', { name: 'Compare suppliers' }).click();
  await expect(suppliers.getByRole('article').first()).toContainText('Chanthaburi Orchard');
  await expect(suppliers.getByText('Compare again to refresh these matches.', { exact: false })).toHaveCount(0);

  await price.fill('101');
  await priorities.click();
  await suppliers.getByRole('button', { name: 'Compare suppliers' }).click();
  await expect(price).toBeFocused();
  await price.fill('0');

  await suppliers.getByRole('combobox', { name: 'Fruit' }).selectOption('pineapple');
  await expect(trends.getByText('Insufficient data', { exact: true })).toBeVisible();
  await expect(trends.getByRole('row', { name: /Social mentions.*Missing.*72.*Unavailable/ })).toBeVisible();
  await suppliers.getByRole('spinbutton', { name: 'Quantity (kg)' }).fill('1000');
  await suppliers.getByRole('button', { name: 'Compare suppliers' }).click();
  await expect(suppliers.getByText('No demo farms match', { exact: false })).toBeVisible();
});

test('an interpreted brief fills the form only after the buyer applies it', async ({ page }) => {
  await page.route(/\/api\/ideas\/idea-b\/agent\/interpret(?:\?|$)/, (route) =>
    route.fulfill({
      json: {
        source: 'openai',
        message: 'Review the suggested fields.',
        draft: {
          fruit: 'pineapple', quantity_kg: '85', delivery_by: null, max_total_thb: null,
          preferences: { price_weight: '100', quality_weight: null, reliability_weight: null, relationship_weight: null },
          unsupported_constraints: ['Organic certification'],
        },
      },
    }),
  );
  await page.goto('/ideas/idea-b');
  await page.getByRole('button', { name: 'English' }).click();
  await page.getByText('Draft an order with AI', { exact: true }).click();
  await page.getByLabel('Describe what you need').fill('85 kg pineapple, low price, organic');
  await page.getByRole('button', { name: 'Draft order' }).click();
  await expect(page.getByText('Organic certification', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Quantity (kg)')).toHaveValue('100');
  await expect(page.getByRole('button', { name: 'Fill comparison form' })).toBeDisabled();
  await page.getByRole('checkbox', { name: 'Compare using the supported requirements only' }).check();
  await page.getByRole('button', { name: 'Fill comparison form' }).click();
  await expect(page.getByLabel('Quantity (kg)')).toHaveValue('85');
  await expect(page.getByRole('combobox', { name: 'Fruit' })).toHaveValue('pineapple');
  await expect(page.getByRole('heading', { name: 'Supplier matches' })).toHaveCount(0);
});

test('Thai is the default and switching to English keeps the order and localizes its results', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 844 });
  await page.goto('/ideas/idea-b');
  await expect(page.getByRole('heading', { name: 'จัดซื้อผลไม้' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'ไทย' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('ความสนใจเพิ่มขึ้น', { exact: true })).toBeVisible();

  const suppliers = page.getByRole('region', { name: 'เปรียบเทียบฟาร์ม' });
  await suppliers.getByRole('spinbutton', { name: 'ปริมาณ (กก.)' }).fill('85');
  await suppliers.getByRole('button', { name: 'เปรียบเทียบฟาร์ม' }).click();
  await expect(suppliers.getByRole('article').first()).toContainText('สวนมะม่วงซันไรส์');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByRole('spinbutton', { name: 'Quantity (kg)' })).toHaveValue('85');
  await expect(page.getByRole('article').first()).toContainText('Sunrise Mango Farm');
  await expect(page.getByText('Rising interest', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Fruit procurement' })).toBeVisible();
});
