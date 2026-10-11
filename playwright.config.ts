import { defineConfig } from "@playwright/test";
import { dataDir, ports } from "./tests/browser/support/ports";
export default defineConfig({
  testDir: "tests/browser",
  testIgnore: "support/**",
  timeout: 120000,
  use: {
    baseURL: `http://localhost:${ports.web}`,
    viewport: { width: 1440, height: 1040 },
    trace: "retain-on-failure",
    actionTimeout: 20000,
  },
  reporter: "list",
  workers: 1,
  webServer: [
    {
      command: "node --import tsx services/executor/src/server.ts",
      port: ports.executor,
      reuseExistingServer: false,
      env: {
        DATA_DIR: dataDir,
        EXECUTOR_PORT: String(ports.executor),
        INTERNAL_KEY: "acceptance-executor-key-not-for-production",
        NODE_ENV: "test",
      },
    },
    {
      command: "node --import tsx tests/browser/support/server.ts",
      port: ports.api,
      reuseExistingServer: false,
    },
    {
      command: "node node_modules/vite/bin/vite.js --host 127.0.0.1 apps/web",
      port: ports.web,
      reuseExistingServer: false,
      env: {
        VITE_PORT: String(ports.web),
        API_PROXY: `http://127.0.0.1:${ports.api}`,
      },
    },
  ],
});
