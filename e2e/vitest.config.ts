import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.e2e.test.ts"],
    // Every test boots real child processes; be generous but never hang CI.
    testTimeout: 120_000,
    hookTimeout: 60_000,
    // Each file boots a full core+node stack; serial files keep ports/processes tame.
    fileParallelism: false,
  },
});
