import { registerPlugin, Capacitor } from '@capacitor/core';
import { apiBaseUrl, apiRequest } from './_util.js';

/**
 * In-app APK updates.
 *
 * BeOnEdge is sideloaded from the company VPS, not installed from the Play
 * Store, so the app has to run its own update loop:
 *
 *   1. ask the native layer which build is actually running
 *   2. ask the backend whether a newer APK has been published
 *   3. download it with progress, verifying the SHA-256 from the manifest
 *   4. hand the verified file to the system package installer
 *
 * Steps 1, 3 and 4 need platform APIs, so they live in the `AppUpdate` Capacitor
 * plugin (android/app/src/main/java/com/beonedge/app/AppUpdatePlugin.java). This
 * module is the thin, web-side contract over it plus the manifest fetch.
 *
 * On the web build the plugin is absent. Every function here degrades to "no
 * update available" rather than throwing, because the updater is a native-only
 * concern and must never break the browser app or the splash screen.
 */

const AppUpdate = registerPlugin('AppUpdate');

/** The update check is only meaningful for an installed APK. */
export function updatesSupported() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

/**
 * The running build, straight from the package manager.
 *
 * Deliberately not read from a bundled constant: the JS bundle and the APK are
 * versioned by different pipelines, and a hardcoded string would drift and make
 * the app either miss updates or offer one it already has.
 */
export async function currentBuild() {
  if (!updatesSupported()) return null;
  try {
    const info = await AppUpdate.getInfo();
    return {
      applicationId: info?.applicationId || '',
      versionName: info?.versionName || '',
      versionCode: Number(info?.versionCode ?? 0),
      canInstall: Boolean(info?.canInstall),
    };
  } catch {
    return null;
  }
}

/** "0.7.4-dev.0.gabc123" -> "0.7.4"; the backend compares dotted versions. */
function baseVersion(value) {
  const match = /^[0-9]+(?:\.[0-9]+)*/.exec(String(value || ''));
  return match ? match[0] : '';
}

/**
 * Ask the backend whether there is a newer published APK for this exact build.
 *
 * Uses `fetch` directly rather than the shared `apiRequest`: this runs on the
 * splash screen before any session exists, and it must not participate in the
 * 401-refresh/session-invalidation machinery that `apiRequest` drives.
 */
export async function checkForUpdate() {
  if (!updatesSupported()) return null;
  const build = await currentBuild();
  if (build === null) return null;

  const query = new URLSearchParams({
    platform: 'android',
    variant: 'client',
    applicationId: build.applicationId,
    versionCode: String(build.versionCode),
  });
  const version = baseVersion(build.versionName);
  if (version) query.set('version', version);

  try {
    const response = await fetch(`${apiBaseUrl()}/v1/app/update?${query.toString()}`, {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return null;
    const body = await response.json();
    const data = body?.data ?? body;
    // A manifest without a download URL is not actionable: the VPS has the build
    // but nothing is serving it, so treat it as "no update" rather than showing
    // a prompt whose button cannot work.
    if (!data?.updateAvailable || !data?.latest?.url || !data?.latest?.sha256) {
      return { ...data, build, actionable: false };
    }
    return { ...data, build, actionable: true };
  } catch {
    // Offline, DNS failure, backend down: never a user-visible error here.
    return null;
  }
}

/**
 * Tell the backend which build this device is running.
 *
 * Authenticated, and therefore the place where user-attributed bookkeeping
 * happens: the backend files an `app_update_available` notification when the
 * caller is behind, and retires it once the caller reports the newer build. The
 * anonymous update feed stays anonymous.
 *
 * Called once per launch after a session exists. Silent on failure — it is
 * bookkeeping, and the launch dialog does not depend on it.
 */
export async function reportAppVersion() {
  if (!updatesSupported()) return null;
  const build = await currentBuild();
  if (build === null) return null;
  try {
    return await apiRequest('/v1/client/app-version', {
      method: 'POST',
      body: {
        platform: 'android',
        variant: 'client',
        applicationId: build.applicationId,
        versionName: build.versionName,
        versionCode: build.versionCode,
      },
    });
  } catch {
    return null;
  }
}

/** Has the user allowed this app to install packages? (API 26+ gate.) */
export async function canInstall() {
  if (!updatesSupported()) return false;
  try {
    const result = await AppUpdate.canInstall();
    return Boolean(result?.granted);
  } catch {
    return false;
  }
}

/**
 * Send the user to the system "install unknown apps" screen. Resolves as soon as
 * the screen is opened; the caller re-checks `canInstall()` on resume, since the
 * user can leave that screen by any route.
 */
export async function requestInstallPermission() {
  if (!updatesSupported()) return false;
  try {
    const result = await AppUpdate.requestInstallPermission();
    return Boolean(result?.granted);
  } catch {
    return false;
  }
}

/**
 * Download the APK described by a manifest's `latest` block.
 *
 * `onProgress` receives { receivedBytes, totalBytes, percent }. The listener is
 * removed in `finally` so a cancelled or failed download cannot leave a handler
 * attached that writes into an unmounted component's state.
 */
export async function downloadUpdate(latest, onProgress) {
  if (!updatesSupported()) throw new Error('Updates are only available in the Android app.');
  if (!latest?.url || !latest?.sha256) throw new Error('This update is missing its download details.');

  let listener = null;
  try {
    if (typeof onProgress === 'function') {
      listener = await AppUpdate.addListener('downloadProgress', (event) => {
        onProgress({
          receivedBytes: Number(event?.receivedBytes ?? 0),
          totalBytes: Number(event?.totalBytes ?? 0),
          percent: typeof event?.percent === 'number' ? event.percent : null,
        });
      });
    }
    return await AppUpdate.downloadUpdate({
      url: latest.url,
      sha256: latest.sha256,
      sizeBytes: Number(latest.sizeBytes ?? 0),
    });
  } finally {
    if (listener) await listener.remove();
  }
}

/**
 * Launch the installer for the verified download.
 *
 * Resolving here means "the system installer is on screen", not "the update is
 * installed" — a successful install replaces this process, so there is nobody
 * left to hear a success callback.
 */
export async function installUpdate(path) {
  if (!updatesSupported()) throw new Error('Updates are only available in the Android app.');
  const result = await AppUpdate.installUpdate(path ? { path } : {});
  return Boolean(result?.launched);
}

/** Human-readable download size for the prompt. */
export function formatBytes(bytes) {
  const value = Number(bytes ?? 0);
  if (!Number.isFinite(value) || value < 0) return '';
  // 0 is a real, meaningful value while a download is starting: returning ''
  // would render the progress row as a bare "/ 2.4 MB".
  if (value === 0) return '0 KB';
  const mb = value / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(value / 1024)} KB`;
}
