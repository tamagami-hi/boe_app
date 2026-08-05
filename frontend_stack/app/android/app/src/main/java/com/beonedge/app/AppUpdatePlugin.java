package com.beonedge.app;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * AppUpdate — sideloaded APK self-update.
 *
 * BeOnEdge is distributed as a signed APK from the company VPS, not through the
 * Play Store, so none of the in-app-update libraries apply: they all delegate to
 * the Play Store client. This plugin does the three things the web layer cannot:
 *
 *   getInfo()          report the running build's versionName / versionCode /
 *                      applicationId, which the update check needs to send
 *   downloadUpdate()   stream an APK to app-private storage, emitting progress,
 *                      and verify its SHA-256 before declaring success
 *   installUpdate()    hand the verified file to the system package installer
 *   canInstall() /     inspect and request the "install unknown apps" permission
 *   requestInstallPermission()
 *
 * ── WHY DOWNLOAD AND INSTALL ARE SEPARATE CALLS ─────────────────────────────
 * The user sees a progress dialog while bytes arrive and an explicit "Install"
 * button when they are verified. Fusing the two would fire the system installer
 * dialog without warning, which reads as a hijack and is easy to dismiss by
 * accident — and a dismissed install would then need a fresh download.
 *
 * ── WHY THE HASH IS CHECKED HERE, NOT TRUSTED FROM TLS ──────────────────────
 * TLS protects the transfer; it says nothing about whether the bytes on the VPS
 * are the bytes the release pipeline produced. The expected digest travels with
 * the update manifest (which the backend derives from the release sidecar), so a
 * truncated publish, a half-replaced file, or a tampered artifact fails closed
 * here instead of reaching the package installer.
 *
 * ── WHERE THE FILE LIVES ────────────────────────────────────────────────────
 * `getCacheDir()/updates/`. App-private, so no storage permission is needed and
 * no other app can substitute the file between verification and install; the
 * cache directory also means an abandoned download cannot leak disk forever.
 * The install Intent needs to hand a readable URI to a *different* process, so
 * the file is exposed through the FileProvider already declared in the manifest
 * with a one-shot read grant.
 */
@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {

    private static final String EVENT_PROGRESS = "downloadProgress";
    private static final String UPDATE_DIR = "updates";
    private static final int CONNECT_TIMEOUT_MS = 20_000;
    private static final int READ_TIMEOUT_MS = 60_000;
    private static final int BUFFER_BYTES = 64 * 1024;
    /** Progress events are throttled to this cadence to keep the bridge quiet. */
    private static final long PROGRESS_INTERVAL_MS = 200;

    /**
     * Single-threaded: one download at a time is the only sane policy for an
     * updater, and it means `activeDownload` fully describes the plugin's state.
     */
    private final ExecutorService downloads = Executors.newSingleThreadExecutor();
    private final AtomicBoolean activeDownload = new AtomicBoolean(false);

    /** The verified file from the last successful download, if any. */
    private File verifiedApk = null;

    // ── version information ─────────────────────────────────────────────────

    @PluginMethod
    public void getInfo(PluginCall call) {
        try {
            PackageManager packageManager = getContext().getPackageManager();
            String packageName = getContext().getPackageName();
            PackageInfo info = packageManager.getPackageInfo(packageName, 0);

            JSObject result = new JSObject();
            result.put("applicationId", packageName);
            result.put("versionName", info.versionName == null ? "" : info.versionName);
            // getLongVersionCode() replaced the int accessor in API 28; the app's
            // minSdk is lower, so both paths are needed.
            long versionCode;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                versionCode = info.getLongVersionCode();
            } else {
                versionCode = info.versionCode;
            }
            result.put("versionCode", versionCode);
            result.put("canInstall", mayInstallPackages());
            call.resolve(result);
        } catch (PackageManager.NameNotFoundException error) {
            // The app asking about itself cannot be missing; treat as fatal-but-handled.
            call.reject("Could not read the installed app version", error);
        }
    }

    // ── install permission ──────────────────────────────────────────────────

    /**
     * From API 26 the REQUEST_INSTALL_PACKAGES manifest permission is not enough:
     * the user must also have allowed this specific app to install unknown apps.
     */
    private boolean mayInstallPackages() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
        return getContext().getPackageManager().canRequestPackageInstalls();
    }

    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", mayInstallPackages());
        call.resolve(result);
    }

    /**
     * Opens the system settings page for this app's install permission. There is
     * no callback contract here on purpose: the caller re-checks `canInstall()`
     * when the app resumes, which is the only reliable signal since the user may
     * leave the settings screen by any route.
     */
    @PluginMethod
    public void requestInstallPermission(PluginCall call) {
        if (mayInstallPackages()) {
            JSObject result = new JSObject();
            result.put("granted", true);
            call.resolve(result);
            return;
        }
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("No activity available to request the install permission");
            return;
        }
        try {
            Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(intent);
            JSObject result = new JSObject();
            result.put("granted", false);
            result.put("settingsOpened", true);
            call.resolve(result);
        } catch (RuntimeException error) {
            call.reject("Could not open the install-permission settings", error);
        }
    }

    // ── download ────────────────────────────────────────────────────────────

    @PluginMethod
    public void downloadUpdate(PluginCall call) {
        String url = call.getString("url");
        String expectedSha256 = call.getString("sha256");
        if (url == null || url.isEmpty()) {
            call.reject("url is required");
            return;
        }
        if (expectedSha256 == null || expectedSha256.isEmpty()) {
            // Refusing rather than defaulting to "skip verification": an updater
            // that silently installs unverified bytes is worse than no updater.
            call.reject("sha256 is required");
            return;
        }
        // Only https: the download is an executable that is about to be installed.
        if (!url.toLowerCase(Locale.ROOT).startsWith("https://")) {
            call.reject("Update downloads must use https");
            return;
        }
        if (!activeDownload.compareAndSet(false, true)) {
            call.reject("A download is already in progress");
            return;
        }

        final String downloadUrl = url;
        final String expected = expectedSha256.toLowerCase(Locale.ROOT);
        final long declaredSize = optLong(call, "sizeBytes");

        // setKeepAlive lets the single call resolve later, after the worker runs.
        call.setKeepAlive(true);
        downloads.execute(() -> {
            try {
                File target = download(downloadUrl, expected, declaredSize);
                verifiedApk = target;
                JSObject result = new JSObject();
                result.put("path", target.getAbsolutePath());
                result.put("sizeBytes", target.length());
                result.put("sha256", expected);
                result.put("canInstall", mayInstallPackages());
                call.resolve(result);
            } catch (Exception error) {
                String message = error.getMessage();
                call.reject(message == null ? "Update download failed" : message, error);
            } finally {
                activeDownload.set(false);
            }
        });
    }

    /**
     * Read a numeric argument regardless of how the bridge typed it.
     *
     * `PluginCall.getLong()` returns null when the JSON value arrived as an
     * Integer, which is what happens for any JS number small enough to fit — so
     * a plain getLong() silently loses the APK size and the progress bar falls
     * back to indeterminate. Reading through the raw JSON object avoids that.
     */
    private static long optLong(PluginCall call, String key) {
        try {
            return (long) call.getData().optDouble(key, 0d);
        } catch (RuntimeException error) {
            return 0L;
        }
    }

    /**
     * Stream the APK to a temporary file, hashing as it goes, then rename it into
     * place only if the digest matches.
     *
     * Hashing during the single pass avoids re-reading several megabytes, and the
     * temp-then-rename keeps a partially written or mismatched download from ever
     * appearing at the path that `installUpdate()` will use.
     */
    private File download(String url, String expectedSha256, long declaredSize) throws Exception {
        File directory = new File(getContext().getCacheDir(), UPDATE_DIR);
        if (!directory.exists() && !directory.mkdirs()) {
            throw new IllegalStateException("Could not create the update directory");
        }
        // One slot, reused: an interrupted download must not accumulate copies.
        File partial = new File(directory, "update.apk.part");
        File finished = new File(directory, "update.apk");
        if (partial.exists() && !partial.delete()) {
            throw new IllegalStateException("Could not clear the previous partial download");
        }

        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
        connection.setReadTimeout(READ_TIMEOUT_MS);
        connection.setRequestProperty("Accept", "application/vnd.android.package-archive");
        // Redirects are followed by default, but only http->http / https->https;
        // a downgrade would be dropped rather than silently followed.
        try {
            connection.connect();
            int status = connection.getResponseCode();
            if (status < 200 || status > 299) {
                throw new IllegalStateException("Download failed with HTTP " + status);
            }

            long contentLength = connection.getContentLengthLong();
            /*
             * The manifest's size wins over Content-Length. If the server applies
             * transport compression, Content-Length is the *compressed* byte count
             * while this loop counts decompressed bytes, which would drive the
             * progress bar past 100% and "finish" early. The manifest size comes
             * from the release sidecar and always describes the real file.
             */
            long total = declaredSize > 0 ? declaredSize : contentLength;
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[BUFFER_BYTES];
            long received = 0;
            long lastEmit = 0;

            try (InputStream input = connection.getInputStream();
                 OutputStream output = new FileOutputStream(partial)) {
                int read;
                while ((read = input.read(buffer)) != -1) {
                    output.write(buffer, 0, read);
                    digest.update(buffer, 0, read);
                    received += read;

                    long now = System.currentTimeMillis();
                    if (now - lastEmit >= PROGRESS_INTERVAL_MS) {
                        lastEmit = now;
                        emitProgress(received, total);
                    }
                }
                output.flush();
            }
            // Always land on a final 100% event so the UI never sticks at 99%.
            emitProgress(received, total > 0 ? total : received);

            String actual = hex(digest.digest());
            if (!actual.equals(expectedSha256)) {
                partial.delete();
                throw new IllegalStateException(
                        "Downloaded file does not match the expected checksum");
            }
            if (finished.exists() && !finished.delete()) {
                throw new IllegalStateException("Could not replace the previous download");
            }
            if (!partial.renameTo(finished)) {
                throw new IllegalStateException("Could not finalise the download");
            }
            return finished;
        } finally {
            connection.disconnect();
        }
    }

    private void emitProgress(long received, long total) {
        JSObject event = new JSObject();
        event.put("receivedBytes", received);
        event.put("totalBytes", total);
        // Percent is computed here so every consumer agrees on the rounding, and
        // is null when the server sent no length rather than a fake 0.
        if (total > 0) {
            int percent = (int) Math.min(100, (received * 100L) / total);
            event.put("percent", percent);
        }
        notifyListeners(EVENT_PROGRESS, event);
    }

    private static String hex(byte[] bytes) {
        StringBuilder builder = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) {
            builder.append(Character.forDigit((value >> 4) & 0xF, 16));
            builder.append(Character.forDigit(value & 0xF, 16));
        }
        return builder.toString();
    }

    // ── install ─────────────────────────────────────────────────────────────

    /**
     * Launch the system package installer for the verified download.
     *
     * This resolves as soon as the installer has been launched. It cannot report
     * whether the install succeeded: a successful install replaces this very
     * process, so there is nothing left to deliver a result to. The web layer
     * treats "installer launched" as the end of its flow.
     */
    @PluginMethod
    public void installUpdate(PluginCall call) {
        String path = call.getString("path");
        File apk = path != null && !path.isEmpty() ? new File(path) : verifiedApk;
        if (apk == null || !apk.exists()) {
            call.reject("No verified update file to install. Download it first.");
            return;
        }
        // Confine installs to our own cache directory: `path` arrives from the
        // web layer, and an arbitrary path would let a compromised WebView ask
        // for any readable APK on the device to be installed.
        File allowed = new File(getContext().getCacheDir(), UPDATE_DIR);
        try {
            if (!apk.getCanonicalPath().startsWith(allowed.getCanonicalPath() + File.separator)) {
                call.reject("Refusing to install a file from outside the update directory");
                return;
            }
        } catch (Exception error) {
            call.reject("Could not verify the update file location", error);
            return;
        }
        if (!mayInstallPackages()) {
            call.reject("The app is not allowed to install updates yet");
            return;
        }

        Activity activity = getActivity();
        if (activity == null) {
            call.reject("No activity available to start the installer");
            return;
        }

        try {
            Uri uri = FileProvider.getUriForFile(
                    getContext(), getContext().getPackageName() + ".fileprovider", apk);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            // The installer runs in another process, so it needs an explicit,
            // one-shot read grant for this URI.
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            activity.startActivity(intent);

            JSObject result = new JSObject();
            result.put("launched", true);
            call.resolve(result);
        } catch (RuntimeException error) {
            call.reject("Could not start the package installer", error);
        }
    }

    @Override
    protected void handleOnDestroy() {
        downloads.shutdownNow();
        super.handleOnDestroy();
    }
}
