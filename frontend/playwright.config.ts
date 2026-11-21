import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { defineConfig } from '@playwright/test';

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
const webPort = 5174;
const apiPort = process.env.TEST_API_PORT ?? '3001';

export default defineConfig({
  workers: process.platform === 'win32' ? 1 : undefined,
  testMatch: ['tests/**/*.spec.ts'],
  forbidOnly: Boolean(process.env.CI),
  use: { baseURL: `http://127.0.0.1:${webPort}` },
  webServer: [
    {
      command: 'uv run --locked python -m backend.src.app.server',
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      url: `http://127.0.0.1:${apiPort}/api/health`,
      env: { API_PORT: apiPort, API_HOST: '127.0.0.1', OPENAI_API_KEY: '', FARMER_DATA_DIR: join(tmpdir(), 'maract-e2e-' + randomUUID()) },
    },
    {
      command: `npm run dev -- --port ${webPort}`,
      url: `http://127.0.0.1:${webPort}/`,
      env: { API_PORT: apiPort },
    },
  ],
});
