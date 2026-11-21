import { expect, test } from '@playwright/test';

test('shows the shop picker and recovers from a failed shop request', async ({ page }) => {
  await page.route('**/api/ideas/idea-a/auth/session', (route) =>
    route.fulfill({ json: { email: 'buyer@example.test' } }));
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

test('sign-in gates the marketplace, resumes on reload, and clears data on expiry and sign-out', async ({ page }) => {
  let authenticated = false;
  let shopRequests = 0;
  await page.route('**/api/ideas/idea-a/auth/session', (route) => authenticated
    ? route.fulfill({ json: { email: 'buyer@example.test' } })
    : route.fulfill({ status: 401 }));
  await page.route('**/api/ideas/idea-a/auth/login', (route) => {
    authenticated = route.request().postDataJSON().password === 'test-demo-password';
    return authenticated ? route.fulfill({ json: { email: 'buyer@example.test' } })
      : route.fulfill({ status: 401 });
  });
  await page.route('**/api/ideas/idea-a/auth/logout', (route) => {
    authenticated = false;
    return route.fulfill({ status: 204 });
  });
  await page.route('**/api/ideas/idea-a/shops', (route) => {
    shopRequests++;
    return route.fulfill({ json: { shops: [
      { id: 'demo', name: 'Smoothie Café', category: 'smoothie', menu_tags: [] },
    ] } });
  });

  await page.goto('/ideas/idea-a');
  await expect(page.getByRole('heading', { name: 'Sign in to the marketplace' })).toBeVisible();
  expect(shopRequests).toBe(0);
  await page.getByLabel('Email').fill('buyer@example.test');
  await page.getByLabel('Password').fill('incorrect');
  await page.getByLabel('Password').press('Enter');
  await expect(page.getByRole('alert')).toContainText('Could not sign in');
  await expect(page.getByLabel('Password')).toHaveValue('');
  await page.getByLabel('Password').fill('test-demo-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Choose your shop' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('group', { name: 'Choose your shop' })).toBeVisible();
  authenticated = false;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByLabel('Password')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Choose your shop' })).toHaveCount(0);

  await page.getByLabel('Email').fill('buyer@example.test');
  await page.getByLabel('Password').fill('test-demo-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByLabel('Password')).toBeVisible();
  await page.getByRole('combobox', { name: 'Idea' }).selectOption('idea-b');
  await expect(page.getByRole('heading', { name: 'Idea B' })).toBeVisible();
});
