import { defineConfig, devices } from '@playwright/test';

const apiPort = Number(process.env.E2E_API_PORT ?? 4310);
const webPort = Number(process.env.E2E_WEB_PORT ?? 4311);
const isCI = Boolean(process.env.CI);
// Set E2E_BASE_URL to test a running stack (for example make local) instead of starting one.
const externalBaseURL = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: externalBaseURL ?? `http://localhost:${String(webPort)}`,
    locale: 'en-US',
    timezoneId: 'America/Toronto',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium-desktop',
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'chromium-mobile',
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer:
    externalBaseURL !== undefined
      ? []
      : [
          {
            command: 'node scripts/start-api.mjs',
            env: { E2E_API_PORT: String(apiPort) },
            url: `http://localhost:${String(apiPort)}/api/health`,
            reuseExistingServer: false,

            gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
          },
          {
            command: `npm run preview -w @todo/web -- --port ${String(webPort)} --strictPort`,
            cwd: '..',
            env: { E2E_API_URL: `http://localhost:${String(apiPort)}` },
            url: `http://localhost:${String(webPort)}`,
            reuseExistingServer: false,
          },
        ],
});
