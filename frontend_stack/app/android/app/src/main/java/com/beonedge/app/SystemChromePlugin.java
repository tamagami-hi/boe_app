package com.beonedge.app;

import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.view.View;
import android.view.ViewParent;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "SystemChrome")
public class SystemChromePlugin extends Plugin {

    @PluginMethod
    public void setBarBackground(PluginCall call) {
        String value = call.getString("color");
        if (value == null) {
            call.reject("A color is required");
            return;
        }

        final int parsed;
        try {
            parsed = Color.parseColor(value);
        } catch (IllegalArgumentException error) {
            call.reject("Unrecognised color: " + value);
            return;
        }

        getActivity()
                .runOnUiThread(() -> {
                    getActivity().getWindow().setBackgroundDrawable(new ColorDrawable(parsed));
                    getActivity().getWindow().getDecorView().setBackgroundColor(parsed);

                    ViewParent parent = getBridge().getWebView().getParent();
                    while (parent instanceof View) {
                        ((View) parent).setBackgroundColor(parsed);
                        parent = parent.getParent();
                    }

                    call.resolve();
                });
    }
}
