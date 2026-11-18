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
        // Capacitor's SystemBars plugin sets a decor-view listener that pads the decor
        // view by the full IME height whenever the keyboard is visible, which shrinks
        // the web viewport, lifts the sticky bottom navigation and reflows every
        // dvh-based shell. The manifest's adjustNothing stops the *window* resizing and
        // the viewport meta's interactive-widget=overlays-content stops *Chromium*
        // resizing, but neither reaches that padding.
        //
        // A view holds one such listener, so this one replaces the plugin's: none of
        // its padding is applied and it injects no --safe-area-inset-* variables. The
        // IME inset is cleared here, at the decor view where dispatch starts, and the
        // other insets reach the WebView unchanged through onApplyWindowInsets. Below
        // WebView 140 Chromium's env(safe-area-inset-*) leaves out the system bars, so
        // this listener publishes the variables itself, computed as the plugin's
        // injectSafeAreaCSS computes them except that the bottom drops to 0 only under
        // a keyboard with a bottom inset; tokens-core.css reads them before env().
        //
        // insetsHandling is deliberately left on "css": only then does the plugin
        // re-request insets once the page commits, which is when the first values
        // published here land.
        ViewCompat.setOnApplyWindowInsetsListener(getWindow().getDecorView(), (view, insets) -> {
            boolean keyboardVisible = insets.isVisible(WindowInsetsCompat.Type.ime());
            int imeBottom = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom;
            publishKeyboardHeight(keyboardVisible ? imeBottom : 0);
            publishSafeArea(
                insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout()),
                keyboardVisible && imeBottom > 0
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
    // Density-scaled to CSS pixels, like the --safe-area-inset-* values.
    //
    // Published on every dispatch rather than only on change. The first dispatch happens
    // before the document exists, so that write is lost; the plugin re-requests insets
    // once the page commits, and an unconditional write is what makes the value land
    // then. Inset dispatch is not a hot path.
    private void publishKeyboardHeight(int bottomPx) {
        int cssPx = Math.round(bottomPx / getResources().getDisplayMetrics().density);

        evaluateOnPage(String.format(
            Locale.US,
            "try {"
                + " document.documentElement.style.setProperty('--be-keyboard-height', '%dpx');"
                + " window.dispatchEvent(new CustomEvent('be:keyboard', { detail: { height: %d } }))"
                + " } catch (e) {}",
            cssPx,
            cssPx
        ));
    }

    private void publishSafeArea(Insets safeArea, boolean keyboardCoversBottom) {
        float density = getResources().getDisplayMetrics().density;

        evaluateOnPage(String.format(
            Locale.US,
            "try {"
                + " document.documentElement.style.setProperty('--safe-area-inset-top', '%dpx');"
                + " document.documentElement.style.setProperty('--safe-area-inset-right', '%dpx');"
                + " document.documentElement.style.setProperty('--safe-area-inset-bottom', '%dpx');"
                + " document.documentElement.style.setProperty('--safe-area-inset-left', '%dpx')"
                + " } catch (e) {}",
            (int) (safeArea.top / density),
            (int) (safeArea.right / density),
            (int) ((keyboardCoversBottom ? 0 : safeArea.bottom) / density),
            (int) (safeArea.left / density)
        ));
    }

    private void evaluateOnPage(String script) {
        Bridge bridge = getBridge();
        if (bridge == null || bridge.getWebView() == null) return;

        bridge.getWebView().evaluateJavascript(script, null);
    }

}
