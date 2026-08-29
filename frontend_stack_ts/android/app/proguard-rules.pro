# BeOnEdge (Capacitor) R8/ProGuard rules.
#
# capacitor-android ships CONSUMER rules (proguard-rules.pro inside
# node_modules/@capacitor/android/capacitor) that already keep:
#   - @CapacitorPlugin classes and their @PluginMethod/@PermissionCallback/@ActivityCallback methods
#   - classes extending com.getcapacitor.Plugin
#   - legacy @NativePlugin classes and org.apache.cordova.* subclasses
# Those are NOT duplicated here. What follows is what the consumer rules miss.

# WebView <-> JavaScript bridge: any @JavascriptInterface method is invoked by
# name from JS, so R8 must not rename or strip it.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface

# Capacitor bridge core (Bridge, JSInjector, MessageHandler, …) is reached by
# name from the injected JS and via reflection; the consumer rules only cover
# plugin classes, not the bridge itself.
-keep class com.getcapacitor.** { *; }

# Keep plugin annotation metadata so runtime reflection on annotations works.
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod

# Readable crash stack traces from minified release builds.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
