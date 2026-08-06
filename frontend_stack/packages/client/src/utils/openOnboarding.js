import { Capacitor } from '@capacitor/core';

const url = import.meta.env.VITE_BEO_ONBOARDING_URL || 'https://beonedge.in/signup';

export async function openOnboarding() {
  if (Capacitor.isNativePlatform()) {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url });
  } else {
    window.open(url, '_blank', 'noopener');
  }
}
