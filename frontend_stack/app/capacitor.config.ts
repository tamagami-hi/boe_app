import type { CapacitorConfig } from '@capacitor/cli';

export const ADMIN_ANDROID_PLUGINS = [
  '@aparajita/capacitor-secure-storage',
  '@capacitor/app',
  '@capacitor/browser',
  '@capacitor/local-notifications',
  '@capgo/capacitor-native-biometric',
];

export const CLIENT_ANDROID_PLUGINS = [...ADMIN_ANDROID_PLUGINS];

const target = process.env.BOE_CAPACITOR_VARIANT;

if (target !== 'client' && target !== 'admin') {
  throw new Error('BOE_CAPACITOR_VARIANT must be client or admin for Capacitor commands.');
}

const config: CapacitorConfig = {
  appId: 'com.beonedge.app',
  appName: 'BeOnEdge',
  webDir: 'dist',
  loggingBehavior: 'none',
  server: {
    androidScheme: 'https',
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
    zoomEnabled: false,
    includePlugins: target === 'client' ? CLIENT_ANDROID_PLUGINS : ADMIN_ANDROID_PLUGINS,
  },
  plugins: {
    SystemBars: {
      insetsHandling: 'css',
      style: 'LIGHT',
    },
  },
};

export default config;
