import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './scc-working-copy/tests',
  fullyParallel: false,
  forbidOnly: false,
  retries: 0,
  workers: 1,
  reporter: 'html',
  use: {
    baseURL: 'https://asos.staging.e2open.com',
    trace: 'on-first-retry',
    video: 'on-first-retry',  // Record video on retry/failure
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
