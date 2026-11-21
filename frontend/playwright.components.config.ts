import { defineConfig } from '@playwright/test';

const baseURL = 'http://127.0.0.1:5175';

export default defineConfig({
  testMatch: 'src/ideas/idea-a/{stock-editor,plan-review,order-confirmation,market*}.spec.ts',
  forbidOnly: Boolean(process.env.CI),
  use: { baseURL },
  webServer: {
    command: 'npm run dev -- --port 5175',
    url: baseURL,
  },
});
