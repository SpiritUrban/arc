import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

const arc = "http://127.0.0.1:4428";
const react = "http://127.0.0.1:4429";
const benchmark = process.env.WORKSPACE_BENCH === "1";
const root = fileURLToPath(new URL("../../", import.meta.url));
const reactRoot = fileURLToPath(
  new URL("../../examples/react-workspace/", import.meta.url),
);

export default defineConfig({
  testDir: ".",
  testMatch: benchmark ? "comparison.spec.mjs" : "workspace.spec.mjs",
  workers: benchmark ? 1 : 2,
  webServer: [
    {
      command: `npm run build && node framework/arc.mjs ${benchmark ? "stand" : "start"}`,
      cwd: root,
      env: {
        ARC_APP: "dist/examples/workspace/app.js",
        PORT: "4428",
        STAND_PORT: "4430",
      },
      url: arc,
      timeout: 120_000,
    },
    {
      command: "npm run build && npm start",
      cwd: reactRoot,
      env: { PORT: "4429" },
      url: react,
      timeout: 120_000,
    },
  ],
  use: { browserName: "chromium", trace: "retain-on-failure" },
  projects: [
    { name: "arc", use: { baseURL: arc } },
    { name: "react", use: { baseURL: react } },
  ],
});
