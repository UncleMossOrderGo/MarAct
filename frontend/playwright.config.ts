import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { defineConfig } from '@playwright/test';

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
process.env.MARACT_BROWSER_SCHEMA ??= 'playwright_' + randomUUID().replaceAll('-', '');
process.env.PGOPTIONS = [process.env.PGOPTIONS, '-csearch_path=' + process.env.MARACT_BROWSER_SCHEMA]
  .filter(Boolean).join(' ');

const webPort = 5174;
const apiPort = process.env.TEST_API_PORT ?? '3001';

export default defineConfig({
  workers: process.platform === 'win32' ? 1 : undefined,
  testMatch: ['tests/**/*.spec.ts', 'src/features/shop/*.spec.ts'],
  forbidOnly: Boolean(process.env.CI),
  use: { baseURL: `http://127.0.0.1:${webPort}` },
  webServer: [
    {
      command: 'uv run --locked python -m backend.src.testing.browser_server',
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      url: `http://127.0.0.1:${apiPort}/api/health`,
      env: { API_PORT: apiPort, API_HOST: '127.0.0.1', OPENAI_API_KEY: '' },
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
    },
    {
      command: `npm run dev -- --port ${webPort}`,
      url: `http://127.0.0.1:${webPort}/`,
      env: { API_PORT: apiPort },
    },
  ],
});
