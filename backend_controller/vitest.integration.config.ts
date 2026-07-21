import { defineConfig } from "vitest/config"

const COVERAGE_THRESHOLD = 80

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/integration/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 220_000,
    coverage: {
      enabled: true,
      provider: "v8",
      // The PostgreSQL-bound repositories, routes, and domain commands are
      // behaviorally covered here; unit coverage excludes them.
      include: ["src/repositories/**", "src/routes/**", "src/domain/**"],
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
