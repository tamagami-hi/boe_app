import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';

/**
 * The Android notification-shade entry for a pending app update.
 *
 * ── WHY LOCAL AND NOT PUSH ──────────────────────────────────────────────────
 * There is no push infrastructure in this product: no FCM project, no
 * `google-services.json`, no service account. Adding one would put a Google
 * dependency and a credential rotation on the critical path of a sideloaded app,
 * and it would buy nothing here — the update is *discovered* by the app itself
 * when it asks the backend on launch, so the device already knows. A local
 * notification puts that discovery in the same place a push would land, with no
 * server, no token registry and no third party.
 *
 * What it cannot do is reach a user who never opens the app. That is the honest
 * limit, and it is the same limit the in-app inbox has. Real server-initiated
 * push would need FCM credentials — see the note at the bottom of this file.
 *
 * ── WHY IT IS ONGOING AND NOT AUTO-CANCEL ───────────────────────────────────
 * `ongoing` keeps the entry in the shade instead of vanishing on first glance,
 * which is what "remain until the app is updated" asks for. It is cancelled from
 * exactly two places: the update completing, and the launch check finding nothing
 * to offer — so it cannot outlive the update it points at.
 */

// One fixed id, so re-raising replaces rather than stacks. Notification ids are
// per-app integers; this one is arbitrary but must stay stable across releases.
const UPDATE_NOTIFICATION_ID = 7061;
const CHANNEL_ID = 'boe_app_updates';

function supported() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

let channelReady = false;

/**
 * Android 8+ refuses to post a notification without a channel, and Android 13+
 * refuses without runtime permission. Both are established lazily, on the first
 * attempt, so an app that never has an update to announce never asks for
 * anything.
 */
async function prepare() {
  if (channelReady) return true;
  try {
    await LocalNotifications.createChannel({
      id: CHANNEL_ID,
      name: 'App updates',
      description: 'Tells you when a newer version of BeOnEdge is available.',
      importance: 3, // DEFAULT: shows in the shade, no sound interruption.
      visibility: 1, // Public: the text carries no account information.
    });
  } catch {
    // Older Android has no channels; posting still works.
  }
  try {
    const status = await LocalNotifications.checkPermissions();
    if (status?.display !== 'granted') {
      const asked = await LocalNotifications.requestPermissions();
      if (asked?.display !== 'granted') return false;
    }
  } catch {
    return false;
  }
  channelReady = true;
  return true;
}

/** Raise (or refresh) the update entry in the notification shade. */
export async function showUpdateNotification(latest) {
  if (!supported() || !latest?.version) return false;
  if (!(await prepare())) return false;
  try {
    await LocalNotifications.schedule({
      notifications: [
        {
          id: UPDATE_NOTIFICATION_ID,
          channelId: CHANNEL_ID,
          title: 'Update BeOnEdge',
          body: `Version ${latest.version} is ready to install.`,
          // Stays in the shade until we cancel it, and cannot be swiped away.
          ongoing: true,
          autoCancel: false,
          // Tapping opens the app, where the launch dialog is already waiting.
          extra: { versionCode: latest.versionCode ?? null },
        },
      ],
    });
    return true;
  } catch {
    return false;
  }
}

/** Remove the update entry — the update is installed or no longer offered. */
export async function clearUpdateNotification() {
  if (!supported()) return;
  try {
    await LocalNotifications.cancel({ notifications: [{ id: UPDATE_NOTIFICATION_ID }] });
  } catch {
    // Nothing posted, or permission was never granted: nothing to clean up.
  }
}

/*
 * ── IF SERVER-INITIATED PUSH IS EVER NEEDED ─────────────────────────────────
 * The missing pieces are credentials, not code shape: a Firebase project,
 * `google-services.json` in `frontend_stack/app/android/app/`, a service account
 * for the backend to call FCM with, and a table of device tokens registered
 * through the authenticated app-version report that already exists. The
 * reconcile step in `domain/client/reconcileAppVersion.ts` is the natural place
 * to fan out a push, because it already knows precisely which users are behind.
 */
