import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

test('root opens the marketplace and old links keep search and cart state', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL('/market');
  await expect(page.getByRole('navigation', { name: 'Marketplace' })).toBeVisible();
  await page.goto('/ideas/idea-c?q=mango#cart');
  await expect(page).toHaveURL('/market?q=mango#cart');
  await expect(page.getByRole('button', { name: 'ตะกร้า (0)' })).toHaveAttribute('aria-pressed', 'true');
});

test('switching ideas keeps newly created records isolated', async ({ page, request }) => {
  const title = `Smoke test ${randomUUID()}`;
  const switcher = page.getByRole('combobox', { name: 'Idea' });
  const record = page.getByText(title, { exact: true });
  try {
    await page.goto('/ideas/idea-a');
    await page.getByLabel('Record title').fill(title);
    await page.getByRole('button', { name: 'Add record' }).click();
    await expect(record).toBeVisible();

    await switcher.selectOption('idea-b');
    await expect(page).toHaveURL('/market?copilot=1');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(record).toHaveCount(0);
    const records = await (await request.get('/api/ideas/idea-b/records')).json();
    expect(records.map((item: { title: string }) => item.title)).not.toContain(title);

    await page.reload();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL('/ideas/idea-a');
    await expect(switcher).toHaveValue('idea-a');
    await expect(record).toBeVisible();
  } finally {
    execFileSync('uv', ['run', '--locked', 'python', '-m', 'backend.src.testing.records', title], {
      cwd: new URL('../../../', import.meta.url),
    });
  }
});
