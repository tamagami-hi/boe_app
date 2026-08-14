import { defineConfig } from 'vitest/config';

// WARNING: React Router logs `v7_relativeSplatPath` future-flag warnings in
// tests. Do NOT silence them by opting into the flag — that changes
// route-relative resolution behavior (e.g. `<Navigate to="dashboard">`) that
// routing tests in this harness depend on.

// Frontend unit-test harness. Covers the `app` shell and every workspace under
// `packages/*`. Component sources do not consistently import the React default,
// so JSX is compiled with the automatic runtime instead of @vitejs/plugin-react.
export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    environment: 'jsdom',
    include: [
      'app/src/**/*.test.{js,jsx}',
      'packages/*/src/**/*.test.{js,jsx}',
    ],
    setupFiles: ['./vitest.setup.js'],
  },
});
