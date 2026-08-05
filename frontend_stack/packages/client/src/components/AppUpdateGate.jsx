import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { App as CapacitorApp } from '@capacitor/app';
import { ArrowDownToLine, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { useSession } from '../store/SessionContext.jsx';
import * as updater from '../services/appUpdate.js';
import {
  clearUpdateNotification,
  showUpdateNotification,
} from '../services/updateNotification.js';

/**
 * AppUpdateGate — the in-app update prompt.
 *
 * Flow, one screen at a time:
 *
 *   prompt      "Version X is available"       → Update now / Later
 *   permission  Android needs "install unknown apps" allowed first
 *   downloading small box with a progress bar
 *   ready       "Downloaded and verified"      → Install now
 *   failed      what went wrong                → Try again / Later
 *
 * ── WHY IT IS MOUNTED ABOVE THE ROUTES ──────────────────────────────────────
 * Rendered from ClientApp rather than from a page, so a mandatory update can be
 * enforced on the login screen too — a build too old to talk to the API must not
 * be dismissable by simply not logging in.
 *
 * ── WHY IT WAITS FOR THE SPLASH ─────────────────────────────────────────────
 * The check runs immediately (the network round trip overlaps the splash's own
 * minimum display time, so nothing is added to launch latency) but the dialog is
 * withheld while the splash route is showing. Interrupting the brand animation
 * with a system dialog looks like a crash.
 *
 * ── WHY "LATER" DOES NOT STICK ──────────────────────────────────────────────
 * Declining dismisses the dialog for that launch only: the next launch asks
 * again. A sideloaded app has no store to nag from and no push channel, so app
 * open is the only moment an update can be surfaced at all — an update that can
 * be permanently dismissed is an update most users never install. The
 * notification raised alongside it stays in the inbox until the build is
 * actually installed.
 */

/**
 * Dismissal is per *launch*, not per version, and is deliberately not persisted.
 * A module-level flag dies with the JS context, so the next cold start asks
 * again; "Later" only stops the dialog reappearing if the gate remounts during
 * this same run.
 */
let dismissedThisLaunch = false;

export default function AppUpdateGate() {
  const location = useLocation();
  const { user } = useSession();
  const onSplash = location.pathname === '/app/splash';

  const [manifest, setManifest] = useState(null);
  const [phase, setPhase] = useState('idle');
  const [progress, setProgress] = useState({ receivedBytes: 0, totalBytes: 0, percent: null });
  const [downloaded, setDownloaded] = useState(null);
  const [error, setError] = useState('');
  const mountedRef = useRef(true);

  useEffect(() => () => { mountedRef.current = false; }, []);

  /**
   * Report the running build whenever a session appears.
   *
   * The launch check fires before login, when the report would 401, so this
   * covers the case that matters: the first moment the backend can attribute a
   * version to a user. Re-runs on sign-in, which is also when a user who
   * switched accounts should get their own inbox reconciled.
   */
  useEffect(() => {
    if (!user) return;
    updater.reportAppVersion().catch(() => {});
  }, [user]);

  // One check per app launch.
  useEffect(() => {
    let cancelled = false;
    updater
      .checkForUpdate()
      .then(async (result) => {
        if (cancelled || !mountedRef.current) return;

        /*
         * Bookkeeping first, and regardless of whether a dialog is shown: this is
         * what files the inbox entry when the build is behind and retires it once
         * the user has updated. It needs a session, so it silently no-ops on the
         * login screen and catches up on the next launch after sign-in.
         */
        updater.reportAppVersion().catch(() => {});
        if (!result?.actionable) {
          // Nothing to offer: make sure a shade entry from a previous release is
          // not left pointing at a build that is now installed.
          clearUpdateNotification().catch(() => {});
          return;
        }

        // Put it in the notification shade too, so declining the dialog does not
        // make the update disappear.
        showUpdateNotification(result.latest).catch(() => {});

        if (!result.mandatory && dismissedThisLaunch) return;
        setManifest(result);
        setPhase('prompt');
      })
      .catch(() => {
        // checkForUpdate already swallows failures; this is belt and braces.
      });
    return () => { cancelled = true; };
  }, []);

  /**
   * Start (or retry) the download. Called from the prompt, from the retry button,
   * and automatically once the install permission is granted.
   */
  const startDownload = useCallback(async () => {
    if (!manifest?.latest) return;
    setError('');

    // Ask for the install permission *before* spending the user's bandwidth: a
    // download that ends at a permission wall is a wasted download.
    if (!(await updater.canInstall())) {
      setPhase('permission');
      return;
    }

    setProgress({ receivedBytes: 0, totalBytes: Number(manifest.latest.sizeBytes ?? 0), percent: 0 });
    setPhase('downloading');
    try {
      const result = await updater.downloadUpdate(manifest.latest, (event) => {
        if (mountedRef.current) setProgress(event);
      });
      if (!mountedRef.current) return;
      setDownloaded(result);
      setPhase('ready');
    } catch (downloadError) {
      if (!mountedRef.current) return;
      setError(downloadError?.message || 'The download did not complete.');
      setPhase('failed');
    }
  }, [manifest]);

  /**
   * The install permission is granted in system settings, outside the app, so the
   * only reliable moment to re-read it is when the app comes back to the
   * foreground.
   */
  useEffect(() => {
    if (phase !== 'permission') return undefined;
    let handle = null;
    let active = true;
    CapacitorApp.addListener('appStateChange', async ({ isActive }) => {
      if (!isActive || !active) return;
      if (await updater.canInstall()) startDownload();
    })
      .then((listener) => { handle = listener; if (!active) listener.remove(); })
      .catch(() => {});
    return () => {
      active = false;
      if (handle) handle.remove();
    };
  }, [phase, startDownload]);

  const install = useCallback(async () => {
    try {
      // The shade entry has served its purpose; a successful install replaces
      // this process, so clear it before handing over rather than after.
      await clearUpdateNotification();
      await updater.installUpdate(downloaded?.path);
      // Nothing to do on success: the installer takes over the screen, and a
      // completed install restarts the app.
    } catch (installError) {
      setError(installError?.message || 'The installer could not be opened.');
      setPhase('failed');
    }
  }, [downloaded]);

  const dismiss = useCallback(() => {
    // Only for the rest of this launch — see the note at the top of the file.
    dismissedThisLaunch = true;
    setPhase('idle');
    setManifest(null);
  }, []);

  if (phase === 'idle' || manifest === null) return null;
  // Hold everything back until the splash has handed over.
  if (onSplash) return null;

  const latest = manifest.latest || {};
  const mandatory = Boolean(manifest.mandatory);
  // Guarded on the number, not the formatted string: formatBytes renders 0 as
  // "0 KB" for the progress row, which would be nonsense next to "Size".
  const size = Number(latest.sizeBytes ?? 0) > 0 ? updater.formatBytes(latest.sizeBytes) : '';

  return (
    <div className="apk-update-overlay" role="dialog" aria-modal="true" aria-labelledby="apk-update-title">
      <div className="apk-update-box">
        {phase === 'prompt' && (
          <>
            <div className="apk-update-icon"><ArrowDownToLine size={24} strokeWidth={1.6} /></div>
            <h2 className="apk-update-title" id="apk-update-title">
              {mandatory ? 'Update required' : 'Update available'}
            </h2>
            <p className="apk-update-body">
              {mandatory
                ? 'This version of BeOnEdge is no longer supported. Install the latest version to continue.'
                : 'A newer version of BeOnEdge is ready to install.'}
            </p>
            <div className="apk-update-meta">
              <span>Version <strong>{latest.version || latest.versionName}</strong></span>
              {size && <span>Size <strong>{size}</strong></span>}
            </div>
            <div className="apk-update-actions">
              <button type="button" className="be-btn be-btn-primary be-btn-block" onClick={startDownload}>
                Update now
              </button>
              {!mandatory && (
                <button type="button" className="be-btn be-btn-ghost be-btn-block" onClick={dismiss}>
                  Later
                </button>
              )}
            </div>
          </>
        )}

        {phase === 'permission' && (
          <>
            <div className="apk-update-icon"><ShieldAlert size={24} strokeWidth={1.6} /></div>
            <h2 className="apk-update-title" id="apk-update-title">One-time permission</h2>
            <p className="apk-update-body">
              Android needs your permission for BeOnEdge to install its own updates. Turn on
              &ldquo;Allow from this source&rdquo;, then come back — the download starts automatically.
            </p>
            <div className="apk-update-actions">
              <button
                type="button"
                className="be-btn be-btn-primary be-btn-block"
                onClick={() => updater.requestInstallPermission()}
              >
                Open settings
              </button>
              {!mandatory && (
                <button type="button" className="be-btn be-btn-ghost be-btn-block" onClick={dismiss}>
                  Later
                </button>
              )}
            </div>
          </>
        )}

        {phase === 'downloading' && (
          <>
            <div className="apk-update-icon"><ArrowDownToLine size={24} strokeWidth={1.6} /></div>
            <h2 className="apk-update-title" id="apk-update-title">Downloading update</h2>
            <p className="apk-update-body">Keep the app open until the download finishes.</p>
            <div className="apk-update-progress">
              <div
                className="apk-update-track"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                {...(progress.percent === null ? {} : { 'aria-valuenow': progress.percent })}
              >
                <div
                  className={
                    progress.percent === null
                      ? 'apk-update-fill apk-update-fill--indeterminate'
                      : 'apk-update-fill'
                  }
                  style={progress.percent === null ? undefined : { width: `${progress.percent}%` }}
                />
              </div>
              <div className="apk-update-progress-row">
                <span>{progress.percent === null ? 'Downloading…' : `${progress.percent}%`}</span>
                <span>
                  {updater.formatBytes(progress.receivedBytes)}
                  {progress.totalBytes > 0 ? ` / ${updater.formatBytes(progress.totalBytes)}` : ''}
                </span>
              </div>
            </div>
          </>
        )}

        {phase === 'ready' && (
          <>
            <div className="apk-update-icon"><CheckCircle2 size={24} strokeWidth={1.6} /></div>
            <h2 className="apk-update-title" id="apk-update-title">Ready to install</h2>
            <p className="apk-update-body">
              Version {latest.version || latest.versionName} was downloaded and verified.
            </p>
            <div className="apk-update-actions">
              <button type="button" className="be-btn be-btn-primary be-btn-block" onClick={install}>
                Install now
              </button>
              {!mandatory && (
                <button type="button" className="be-btn be-btn-ghost be-btn-block" onClick={dismiss}>
                  Not now
                </button>
              )}
            </div>
            <p className="apk-update-note">
              Android will ask you to confirm the install. Your data and sign-in stay as they are.
            </p>
          </>
        )}

        {phase === 'failed' && (
          <>
            <div className="apk-update-icon apk-update-icon--error"><ShieldAlert size={24} strokeWidth={1.6} /></div>
            <h2 className="apk-update-title" id="apk-update-title">Update failed</h2>
            <p className="apk-update-body">{error}</p>
            <div className="apk-update-actions">
              <button type="button" className="be-btn be-btn-primary be-btn-block" onClick={startDownload}>
                Try again
              </button>
              {!mandatory && (
                <button type="button" className="be-btn be-btn-ghost be-btn-block" onClick={dismiss}>
                  Later
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
