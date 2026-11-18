import { randomBytes } from "node:crypto"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import process from "node:process"
import { defineConfig } from "@playwright/test"

const backendUrl = "http://127.0.0.1:3100"
const frontendUrl = "http://127.0.0.1:5174"
const dataDirectory = join(tmpdir(), `syncstudio-playwright-${randomBytes(8).toString("hex")}`)
process.env.SYNCSTUDIO_E2E_DATA_DIR = dataDirectory

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: frontendUrl,
    browserName: "chromium",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "npm start",
      cwd: resolve("../Backend"),
      url: `${backendUrl}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        PORT: "3100",
        CLIENT_ORIGIN: frontendUrl,
        ROOM_SECRET: randomBytes(32).toString("hex"),
        DATA_DIR: dataDirectory,
        NODE_ENV: "test",
        FIREBASE_SERVICE_ACCOUNT_JSON: "",
      },
    },
    {
      command: "npm run dev -- --host 127.0.0.1 --port 5174 --strictPort",
      url: frontendUrl,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        VITE_CONNECT: backendUrl,
      },
    },
  ],
  globalTeardown: "./playwright.global-teardown.js",
})
