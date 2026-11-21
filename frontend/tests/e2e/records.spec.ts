import { expect, test } from '@playwright/test';

test('Idea A displays its own records and selected idea', async ({ page }) => {
  await page.route('**/api/ideas/idea-a/records', (route) =>
    route.fulfill({ json: [{ id: 1, title: 'Idea A fixture' }] }),
  );
  await page.goto('/legacy/records');
  await expect(page.getByRole('heading', { name: 'Idea A' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Idea' })).toHaveValue('idea-a');
  await expect(page.getByText('Idea A fixture', { exact: true })).toBeVisible();
});
