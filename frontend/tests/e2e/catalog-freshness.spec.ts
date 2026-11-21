import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

test('returning buyers see the current farm price', async ({ page }) => {
  const id = randomUUID();
  const fixture = (code: string) => execFileSync('uv', ['run', '--locked', 'python', '-c', [
    'import sys, psycopg',
    'from backend.tests.marketplace.test_market import browser_lot, cleanup, database_url',
    'key = sys.argv[1]',
    code,
  ].join('\n'), id], { cwd: new URL('../../../', import.meta.url) });
  fixture('browser_lot(key, price=48)');
  try {
    await page.goto('/market?q=' + id);
    const price = page.locator('.market-product .market-price');
    await expect(price).toContainText('48');
    fixture("with psycopg.connect(database_url()) as db: db.execute('UPDATE idea_c_lots SET price=59 WHERE id=%s', (key,))");
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(price).toContainText('59', { timeout: 2500 });
  } finally {
    fixture('cleanup(key)');
  }
});
