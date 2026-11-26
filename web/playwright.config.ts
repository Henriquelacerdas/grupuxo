import { defineConfig, devices } from "@playwright/test";

// E2E contra o servidor local da `api` (backend/tools/local-api: a mesma `createApiHandler` da Lambda, em memória,
// com Cognito emulado e código de confirmação 123456) e o `next start` do web apontando para ele.
const API_PORT = 4010;
const WEB_PORT = 3100;
const env = {
  REVEZA_API_BASE_URL: `http://127.0.0.1:${API_PORT}`,
  COGNITO_USER_POOL_ID: "us-east-1_M9GpISkE3",
  COGNITO_CLIENT_ID: "21gqeeehhmeufpipk84e3cc7tu",
  COGNITO_ENDPOINT: `http://127.0.0.1:${API_PORT}/cognito`,
  SESSION_SECRET: "e2e-session-secret-with-at-least-32-bytes",
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: "",
};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env["CI"] ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-webkit", use: { ...devices["iPhone 15"] }, grep: /@mobile/ },
  ],
  webServer: [
    {
      command: "node tools/local-api/server.ts",
      cwd: "../backend",
      url: `http://127.0.0.1:${API_PORT}/health`,
      env: { PORT: String(API_PORT) },
      reuseExistingServer: !process.env["CI"],
      stdout: "ignore",
    },
    {
      // No CI o build já rodou no passo anterior (mesmas variáveis públicas).
      command: `${process.env["CI"] ? "" : "npx next build && "}npx next start --hostname 127.0.0.1 --port ${WEB_PORT}`,
      url: `http://127.0.0.1:${WEB_PORT}`,
      env,
      timeout: 240_000,
      reuseExistingServer: !process.env["CI"],
    },
  ],
});
