import { expect, test } from '@playwright/test';

test('shows the shop picker and recovers from a failed shop request', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/ideas/idea-a/shops', (route) => {
    if (++calls === 1) return route.fulfill({ status: 503 });
    return route.fulfill({
      json: { shops: [{ id: 'smoothie', name: 'Smoothie Café', category: 'cafe', menu_tags: ['smoothie'] }] },
    });
  });

  await page.goto('/ideas/idea-a');
  await expect(page.getByRole('alert')).toHaveText('Could not load the shops.');
  await page.getByRole('button', { name: 'Retry loading shops' }).click();
  await expect(page.getByRole('radio', { name: 'Smoothie Café' })).toBeChecked();
});
