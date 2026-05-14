import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.mjs"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.mjs"],
      exclude: ["src/cli.mjs", "src/tools/*/mcp.mjs"],
      thresholds: {
        statements: 65,
        branches: 50,
        functions: 65,
        lines: 65,
      },
    },
  },
});
