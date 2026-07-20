import { defineConfig } from "vitest/config"

const COVERAGE_THRESHOLD = 80

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      // repositories/routes/domain are PostgreSQL-bound and gated by the
      // integration coverage config (vitest.integration.config.ts), not here.
      exclude: [
        "src/**/*.test.ts",
        "src/smoke.ts",
        "src/repositories/**",
        "src/routes/**",
        "src/domain/**",
      ],
      include: ["src/**/*.ts"],
      reporter: ["text", "json-summary"],
      thresholds: {
        branches: COVERAGE_THRESHOLD,
        functions: COVERAGE_THRESHOLD,
        lines: COVERAGE_THRESHOLD,
        statements: COVERAGE_THRESHOLD,
      },
    },
  },
})
