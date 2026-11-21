import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';

const envDir = fileURLToPath(new URL('..', import.meta.url));
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, '');
  return {
    envDir,
    server: {
      host: '127.0.0.1',
      port: Number(env.MARACT_WEB_PORT ?? 5173),
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${env.API_PORT ?? 3000}`,
          changeOrigin: false,
        },
      },
    },
  };
});
