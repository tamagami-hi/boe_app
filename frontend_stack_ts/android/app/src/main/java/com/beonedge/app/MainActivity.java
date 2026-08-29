package com.beonedge.app;

import android.os.Build;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // App-local plugins must be registered before the bridge starts, or the
        // web layer sees an unimplemented plugin. AppUpdate backs the in-app
        // APK updater (see AppUpdatePlugin).
        registerPlugin(AppUpdatePlugin.class);
        registerPlugin(SystemChromePlugin.class);

        setTheme(R.style.AppTheme_NoActionBar);

        super.onCreate(savedInstanceState);

        // Keep balances and holdings out of the task switcher.
        //
        // The recents/overview screen caches a screenshot of the last frame, so an
        // investing app leaves portfolio values visible to anyone who opens the app
        // switcher on an unlocked phone, and the image persists in system storage.
        //
        // Deliberately NOT FLAG_SECURE, which would achieve the same thing but also
        // block the user from screenshotting their own statements and make support
        // requests ("send me what you see") impossible. This API disables only the
        // system's own preview capture, so it costs the user nothing.
        //
        // API 33+ only; on older versions the preview remains, which is accepted
        // rather than escalated to FLAG_SECURE.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            setRecentsScreenshotEnabled(false);
        }
    }
}
