import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig(() => {
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
      cssMinify: 'lightningcss',
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              return 'vendor';
            }
            if (id.includes('/packages/admin/')) {
              if (id.endsWith('.css')) return undefined;
              if (id.includes('/screens/fundOps/') || id.includes('FundStockListPanel')) {
                return 'admin-funds';
              }
              if (id.includes('Aum') || id.includes('useAumHistory')) return 'admin-aum';
              if (id.includes('/screens/appBuilder/')) return 'admin-appbuilder';
              if (id.includes('ClientValuesScreen')) return 'admin-client-values';
              if (id.includes('InvestmentReviewScreen')) return 'admin-reviews';
              if (id.includes('UserDetail')) return 'admin-users';
              return 'admin';
            }
            if (id.includes('/packages/client/')) return 'client';
          },
        },
      },
    },
  };
});
