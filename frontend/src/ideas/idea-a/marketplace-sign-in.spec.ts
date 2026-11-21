import { expect, test } from '@playwright/test';

const api = '**/api/ideas/idea-a';
const email = 'buyer@example.test';
const shops = [{ id: 'smoothie', name: 'Smoothie Café', category: 'cafe', menu_tags: ['smoothie'] }];

test('gates marketplace requests, clears a rejected password, restores the session, and signs out', async ({ page }) => {
  let signedIn = false;
  let shopRequests = 0;
  let releaseLogin: () => void = () => {};
  const loginPending = new Promise<void>((resolve) => { releaseLogin = resolve; });
  await page.route(`${api}/auth/session`, (route) => signedIn
    ? route.fulfill({ json: { email } })
    : route.fulfill({ status: 401 }));
  await page.route(`${api}/auth/login`, async (route) => {
    const body = route.request().postDataJSON();
    expect(body.email).toBe(email);
    if (body.password === 'incorrect') {
      await loginPending;
      return route.fulfill({ status: 401, json: { detail: 'Internal server detail' } });
    }
    signedIn = true;
    return route.fulfill({ json: { email } });
  });
  await page.route(`${api}/auth/logout`, (route) => {
    signedIn = false;
    return route.fulfill({ status: 204 });
  });
  await page.route(`${api}/shops`, (route) => {
    shopRequests++;
    return route.fulfill({ json: { shops } });
  });
  await page.route(`${api}/shops/smoothie/feed`, (route) =>
    route.fulfill({ json: { feed_key: 'demo', run_id: null, items: [] } }));
  await page.route(`${api}/shops/smoothie/feed/explanations?*`, (route) =>
    route.fulfill({ contentType: 'text/event-stream', body: 'event: done\ndata: {}\n\n' }));
  await page.route(`${api}/trends/latest`, (route) => route.fulfill({ json: { run: null, cards: [] } }));

  await page.goto('/ideas/idea-a');
  const emailField = page.getByLabel('Email', { exact: true });
  const password = page.getByLabel('Password', { exact: true });
  await expect(emailField).toHaveAttribute('autocomplete', 'username');
  await expect(password).toHaveAttribute('autocomplete', 'current-password');
  expect(shopRequests).toBe(0);
  await emailField.fill(email);
  await password.fill('incorrect');
  await password.press('Enter');
  await expect(page.getByRole('button', { name: 'Signing in…' })).toBeDisabled();
  releaseLogin();
  await expect(page.getByRole('alert')).toHaveText('Could not sign in. Check your email and password.');
  await expect(password).toHaveValue('');
  await expect(emailField).toHaveValue(email);
  expect(shopRequests).toBe(0);

  await password.fill('fixture-only-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Choose your shop' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Active shop' })).toHaveValue('smoothie');
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Active shop' })).toHaveValue('smoothie');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(emailField).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Active shop' })).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem('maract.idea-a.shop'))).toBeNull();
  await page.getByRole('combobox', { name: 'Idea', exact: true }).selectOption('idea-b');
  await expect(page.getByRole('heading', { name: 'Idea B' })).toBeVisible();
});

test('returns to sign-in when a marketplace request rejects an expired session', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('maract.idea-a.shop', 'smoothie'));
  await page.route(`${api}/auth/session`, (route) => route.fulfill({ json: { email } }));
  await page.route(`${api}/shops`, (route) => route.fulfill({ json: { shops } }));
  await page.route(`${api}/shops/smoothie/feed`, (route) => route.fulfill({ status: 401 }));
  await page.route(`${api}/trends/latest`, (route) => route.fulfill({ json: { run: null, cards: [] } }));

  await page.goto('/ideas/idea-a');
  await expect(page.getByRole('heading', { name: 'Sign in to the marketplace' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Active shop' })).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem('maract.idea-a.shop'))).toBeNull();
});
