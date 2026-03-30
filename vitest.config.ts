import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "./coverage",
      thresholds: {
        lines: 20,
        functions: 15,
        statements: 20,
        branches: 8,
      },
      exclude: [
        "src/index.ts",
        "src/types/**",
        "dist/**",
        "coverage/**",
        "tests/**",
      ],
    },
  },
});