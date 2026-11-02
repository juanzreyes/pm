package com.pm.pollito;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

/**
 * Puente entre la parte web (el mismo código de la PC) y lo nativo de Android: el buzón del
 * ecosistema con la app cerrada, avisos sin duplicar, push de Firebase y el pollito flotante.
 */
@CapacitorPlugin(name = "PmNative")
public class PmNativePlugin extends Plugin {

    @Override protected void handleOnResume() { PmCloud.appVisible = true; }
    @Override protected void handleOnPause() { PmCloud.appVisible = false; }
    @Override public void load() { PmCloud.appVisible = true; }

    /** cfg = { url, space, key, device, after } o null para desvincular. */
    @PluginMethod
    public void configure(PluginCall call) {
        try {
            JSObject cfg = call.getObject("cfg", null);
            PmCloud.configure(getContext(), cfg == null ? null : new JSONObject(cfg.toString()));
            call.resolve();
        } catch (Exception e) { call.reject(e.getMessage()); }
    }

    @PluginMethod
    public void notifyOnce(PluginCall call) {
        long id = call.getLong("id", 0L);
        boolean shown = PmCloud.notifyOnce(getContext(), id, call.getString("title", "PM Pollito"), call.getString("body", ""), Boolean.TRUE.equals(call.getBoolean("silent", false)));
        JSObject r = new JSObject();
        r.put("shown", shown);
        call.resolve(r);
    }

    /** Token de Firebase para que la PC pueda "despertar" al teléfono. null si la app no trae google-services.json. */
    @PluginMethod
    public void pushToken(PluginCall call) {
        JSObject r = new JSObject();
        try {
            if (com.google.firebase.FirebaseApp.getApps(getContext()).isEmpty()) { r.put("token", null); r.put("reason", "Firebase sin configurar"); call.resolve(r); return; }
            com.google.firebase.messaging.FirebaseMessaging.getInstance().getToken().addOnCompleteListener(t -> {
                JSObject o = new JSObject();
                o.put("token", t.isSuccessful() ? t.getResult() : null);
                if (!t.isSuccessful() && t.getException() != null) o.put("reason", t.getException().getMessage());
                call.resolve(o);
            });
        } catch (Throwable e) { r.put("token", null); r.put("reason", e.getMessage()); call.resolve(r); }
    }

    /** Revisar el buzón ya, con el trabajo en segundo plano (lo mismo que hace una push de "despierta"). */
    @PluginMethod
    public void checkNow(PluginCall call) {
        PmCloud.checkSoon(getContext());
        call.resolve();
    }

    @PluginMethod
    public void canDrawOverlays(PluginCall call) {
        JSObject r = new JSObject();
        r.put("granted", Settings.canDrawOverlays(getContext()));
        call.resolve(r);
    }

    /** Abre el ajuste de Android "Mostrar sobre otras apps" para PM. */
    @PluginMethod
    public void requestOverlay(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getContext().getPackageName())).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    /** { png (data URL del pollito), name, text? } */
    @PluginMethod
    public void overlayShow(PluginCall call) {
        if (!Settings.canDrawOverlays(getContext())) { call.reject("Falta el permiso para mostrarse sobre otras apps"); return; }
        getContext().getSharedPreferences("pm_overlay", 0).edit().putString("name", call.getString("name", "Tu pollito")).apply();
        Intent i = new Intent(getContext(), PetOverlayService.class).setAction(PetOverlayService.ACTION_SHOW)
            .putExtra("png", call.getString("png", ""))
            .putExtra("text", call.getString("text", ""));
        if (Build.VERSION.SDK_INT >= 26) getContext().startForegroundService(i); else getContext().startService(i);
        call.resolve();
    }

    @PluginMethod
    public void overlayHide(PluginCall call) {
        getContext().stopService(new Intent(getContext(), PetOverlayService.class));
        call.resolve();
    }

    @PluginMethod
    public void overlayRunning(PluginCall call) {
        JSObject r = new JSObject();
        r.put("running", PetOverlayService.running);
        call.resolve(r);
    }
}
