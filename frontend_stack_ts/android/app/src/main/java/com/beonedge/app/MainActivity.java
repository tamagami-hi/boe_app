package com.beonedge.app;

import android.os.Build;
import android.os.Bundle;
import android.view.View;

import java.util.Locale;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.Bridge;
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
            publishKeyboardHeight(
                insets.isVisible(WindowInsetsCompat.Type.ime())
                    ? insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
                    : 0
            );

            WindowInsetsCompat withoutIme = new WindowInsetsCompat.Builder(insets)
                .setInsets(WindowInsetsCompat.Type.ime(), Insets.NONE)
                .setVisible(WindowInsetsCompat.Type.ime(), false)
                .build();

            return ViewCompat.onApplyWindowInsets(view, withoutIme);
        });
    }

    // Publish the keyboard height without letting it move anything.
    //
    // The inset is stripped above so that nothing resizes, which also leaves the web
    // layer with no signal at all: env(keyboard-inset-height) stays 0px, measured. One
    // surface does need to move — the sign-in panel, which the keyboard would otherwise
    // cover with no way to scroll to it — so the height is published as a CSS variable
    // and only that surface consumes it.
    //
    // Density-scaled to CSS pixels, matching how Capacitor injects --safe-area-inset-*.
    //
    // Published on every dispatch rather than only on change. The first dispatch happens
    // before the document exists, so that write is lost; Capacitor re-requests insets on
    // DOM ready, and an unconditional write is what makes the value land then. Inset
    // dispatch is not a hot path.
    private void publishKeyboardHeight(int bottomPx) {
        int cssPx = Math.round(bottomPx / getResources().getDisplayMetrics().density);

        Bridge bridge = getBridge();
        if (bridge == null || bridge.getWebView() == null) return;

        String script = String.format(
            Locale.US,
            "try {"
                + " document.documentElement.style.setProperty('--be-keyboard-height', '%dpx');"
                + " window.dispatchEvent(new CustomEvent('be:keyboard', { detail: { height: %d } }))"
                + " } catch (e) {}",
            cssPx,
            cssPx
        );
        bridge.getWebView().evaluateJavascript(script, null);
    }

}
