import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig(() => {
  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@beonedge/design-tokens': resolve(__dirname, '../packages/design-tokens/src'),
        '@beonedge/ui-kits': resolve(__dirname, '../packages/ui-kits/src'),
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
            if (id.includes('/packages/client/')) return 'client';
            if (id.includes('/packages/ui-kits/')) return 'ui-kits';
          },
        },
      },
    },
  };
});
