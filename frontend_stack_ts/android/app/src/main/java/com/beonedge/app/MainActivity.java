package com.beonedge.app;

import android.os.Build;
import android.os.Bundle;
import android.view.View;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

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

        // Keep the interface still when the keyboard opens.
        //
        // Capacitor's SystemBars listener pads the WebView's parent by the full IME
        // height whenever the keyboard is visible, which shrinks the web viewport,
        // lifts the sticky bottom navigation and reflows every dvh-based shell. The
        // manifest's adjustNothing stops the *window* resizing and the viewport meta's
        // interactive-widget=overlays-content stops *Chromium* resizing, but neither
        // reaches that padding.
        //
        // Clearing the IME inset here, at the decor view where dispatch starts, makes
        // the plugin see no keyboard at all, so it applies its system-bar padding
        // unchanged. Insets are re-dispatched to children via onApplyWindowInsets, so
        // safe-area handling, cutout handling and the injected --safe-area-inset-*
        // variables all behave exactly as before.
        //
        // insetsHandling is deliberately left on "css": Capacitor only passes insets
        // through to Chromium on WebView 140+, so "disable" would lose safe-area
        // handling on the far larger population below that.
        ViewCompat.setOnApplyWindowInsetsListener(getWindow().getDecorView(), (view, insets) -> {
            WindowInsetsCompat withoutIme = new WindowInsetsCompat.Builder(insets)
                .setInsets(WindowInsetsCompat.Type.ime(), Insets.NONE)
                .setVisible(WindowInsetsCompat.Type.ime(), false)
                .build();

            return ViewCompat.onApplyWindowInsets(view, withoutIme);
        });
    }
}
