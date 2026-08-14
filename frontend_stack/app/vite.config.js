import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig(() => {
  // `main.jsx` picks its target with `import.meta.env.VITE_BEO_APP_TARGET === 'client'`.
  // The android build sets it, so the admin branch folds away. The web build did not,
  // so Rollup could not fold either branch and the admin entry ended up preloading
  // the client screen chunk and its 122 kB stylesheet. Defining it here means the web
  // build drops the client subtree the same way the android build drops the admin one.
  const target = process.env.VITE_BEO_APP_TARGET || 'admin';

  return {
    plugins: [react()],
    define: {
      'import.meta.env.VITE_BEO_APP_TARGET': JSON.stringify(target),
    },
    resolve: {
      alias: {
        '@beonedge/design-tokens': resolve(__dirname, '../packages/design-tokens/src'),
        '@beonedge/shared': resolve(__dirname, '../packages/shared/src'),
        '@beonedge/client': resolve(__dirname, '../packages/client/src'),
        '@beonedge/admin': resolve(__dirname, '../packages/admin/src'),
      },
    },
    server: { host: true, port: 5173, open: false, strictPort: true },
    build: {
      chunkSizeWarningLimit: 600,
      // esbuild's CSS parser warns on modern at-rules it doesn't know
      // (@starting-style) and passes them through anyway; Lightning CSS
      // parses them natively and minifies better.
      cssMinify: 'lightningcss',
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              return 'vendor';
            }
            if (id.includes('/packages/admin/')) return 'admin';
            // Client transport, session and route metadata are imported by the ADMIN
            // console too. Bucketing them with the client SCREENS made the admin
            // entry depend on the client chunk, so every admin page load fetched
            // 122 kB of client screen CSS it never uses.
            if (
              id.includes('/packages/client/src/services/')
              || id.includes('/packages/client/src/store/')
              || id.includes('/packages/client/src/navigation/')
              || id.includes('/packages/client/src/auth/')
            ) return 'client-core';
            if (id.includes('/packages/client/')) return 'client';
          },
        },
      },
    },
  };
});
