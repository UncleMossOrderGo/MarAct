import { expect, test } from '@playwright/test';

test.use({
  permissions: ['microphone'],
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
});

test('dictation produces an editable draft and closing the chat cancels a recording', async ({ page }) => {
  let clips = 0;
  let sent = 0;
  await page.route('**/agent/threads', (route) => {
    if (route.request().method() === 'POST') sent++;
    return route.fulfill({ json: { threads: [] } });
  });
  await page.route('**/agent/transcriptions?locale=en', (route) => {
    expect(route.request().postDataBuffer()?.length).toBeGreaterThan(0);
    clips++;
    return route.fulfill({ json: { text: 'Check our milk stock.' } });
  });
  await page.goto('/tests/fixtures/market-assistant.html');
  await page.getByRole('button', { name: 'Ask agent' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Dictate a message' }).click();
  await expect(dialog.getByText(/Recording ·/)).toBeVisible();
  // MediaRecorder needs input frames before it can produce a nonempty audio file.
  await page.waitForTimeout(350);
  await dialog.getByRole('button', { name: 'Stop and transcribe' }).click();
  await expect(dialog.getByRole('textbox')).toHaveValue('Check our milk stock.');
  await dialog.getByRole('textbox').fill('Check our milk and cream stock.');
  await dialog.getByRole('button', { name: 'Dictate a message' }).click();
  await expect(dialog.getByText(/Recording ·/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Close assistant' }).click();
  await page.getByRole('button', { name: 'Ask agent' }).click();
  await expect(dialog.getByRole('button', { name: 'Dictate a message' })).toBeEnabled();
  expect(clips).toBe(1);
  expect(sent).toBe(0);
});
