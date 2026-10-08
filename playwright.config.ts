import { defineConfig } from '@playwright/test';
import { loadE2EEnv, requireE2EConfig } from './scripts/supabase-env.mjs';

loadE2EEnv();
requireE2EConfig();

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 120 * 1000,
  },
});
