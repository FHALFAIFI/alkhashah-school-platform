import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: process.env.APP_URL ?? "http://localhost:3080",
    locale: "ar-SA",
    timezoneId: "Asia/Riyadh",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3080",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
