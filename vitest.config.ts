import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.ts"],
      // index.ts and settings.ts are trivial wiring; the platform/api/accessory
      // logic carries the coverage budget.
      exclude: [
        "src/index.ts",
        "src/settings.ts",
        // types.ts is purely TS interface declarations — no executable code,
        // and vitest's v8 reporter mislabels it as 0% coverage.
        "src/api/types.ts",
      ],
      thresholds: {
        lines: 95,
        branches: 90,
        functions: 95,
        statements: 95,
      },
    },
  },
});
