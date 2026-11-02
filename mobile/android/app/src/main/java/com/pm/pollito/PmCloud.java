package com.pm.pollito;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Base64;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.ExistingWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.OneTimeWorkRequest;
import androidx.work.OutOfQuotaPolicy;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.Arrays;
import java.util.concurrent.TimeUnit;
import java.util.zip.GZIPInputStream;

import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * El ecosistema de PM visto desde el lado nativo del teléfono: con la app cerrada (o en segundo
 * plano) consulta pm-sync, descifra los avisos de la PC y los muestra como notificación.
 *
 * Mismo protocolo que src/cloudsync.js: llave maestra (32 bytes, base64url) → HKDF-SHA256 con sal
 * "pm-pollito-sync-v1" → "cifrado" (AES-256-GCM) y "acceso" (token Bearer). Paquetes =
 * base64url(iv de 12 bytes + cifrado) de un JSON comprimido con gzip.
 */
public final class PmCloud {
    static final String PREFS = "pm_cloud";
    static final String CH_LOUD = "pm";
    static final String CH_QUIET = "pm-quiet";
    /** ¿La app está en pantalla? Entonces avisa la parte web (burbuja del pollito) y aquí no se notifica. */
    static volatile boolean appVisible = false;
    /** El pollito flotante quiere enterarse de los avisos para mostrarlos en su burbuja. */
    static volatile Listener listener = null;

    interface Listener { void onNotice(String title, String body); }

    private PmCloud() {}

    static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    // ---------------------------------------------------------------- configuración
    /** Guarda la configuración del ecosistema (la manda la parte web al unirse o arrancar). null = desvincular. */
    static void configure(Context c, JSONObject cfg) {
        SharedPreferences.Editor e = prefs(c).edit();
        if (cfg == null) {
            e.remove("url").remove("space").remove("key").remove("device").apply();
            WorkManager.getInstance(c).cancelUniqueWork("pm-sync");
            return;
        }
        e.putString("url", cfg.optString("url", "https://pm-sync.eshoy.workers.dev"));
        e.putString("space", cfg.optString("space"));
        e.putString("key", cfg.optString("key"));
        e.putString("device", cfg.optString("device"));
        long after = cfg.optLong("after", 0);
        if (after > prefs(c).getLong("after", 0)) e.putLong("after", after);
        e.apply();
        schedule(c);
    }
    static boolean configured(Context c) {
        SharedPreferences p = prefs(c);
        return p.getString("space", null) != null && p.getString("key", null) != null && p.getString("device", null) != null;
    }

    /** Revisión periódica (cada 15 min es lo mínimo que permite Android) con red. */
    static void schedule(Context c) {
        Constraints net = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        PeriodicWorkRequest req = new PeriodicWorkRequest.Builder(PmSyncWorker.class, 15, TimeUnit.MINUTES).setConstraints(net).build();
        WorkManager.getInstance(c).enqueueUniquePeriodicWork("pm-sync", ExistingPeriodicWorkPolicy.KEEP, req);
    }
    /** Revisar ya (lo pide una push de "despierta" o el pollito flotante). */
    static void checkSoon(Context c) {
        Constraints net = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        OneTimeWorkRequest req = new OneTimeWorkRequest.Builder(PmSyncWorker.class)
            .setConstraints(net)
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .build();
        WorkManager.getInstance(c).enqueueUniqueWork("pm-sync-now", ExistingWorkPolicy.REPLACE, req);
    }

    // ---------------------------------------------------------------- cifrado
    static byte[] b64d(String s) { return Base64.decode(s, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING); }
    static String b64e(byte[] b) { return Base64.encodeToString(b, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING); }

    static byte[] hmac(byte[] key, byte[] data) throws Exception {
        Mac m = Mac.getInstance("HmacSHA256");
        m.init(new SecretKeySpec(key, "HmacSHA256"));
        return m.doFinal(data);
    }
    /** HKDF-SHA256 (RFC 5869), igual que WebCrypto deriveBits/deriveKey. */
    static byte[] hkdf(byte[] ikm, String info, int len) throws Exception {
        byte[] prk = hmac("pm-pollito-sync-v1".getBytes(StandardCharsets.UTF_8), ikm);
        byte[] out = new byte[len];
        byte[] t = new byte[0];
        int pos = 0;
        for (int i = 1; pos < len; i++) {
            byte[] infoB = info.getBytes(StandardCharsets.UTF_8);
            byte[] in = new byte[t.length + infoB.length + 1];
            System.arraycopy(t, 0, in, 0, t.length);
            System.arraycopy(infoB, 0, in, t.length, infoB.length);
            in[in.length - 1] = (byte) i;
            t = hmac(prk, in);
            int n = Math.min(t.length, len - pos);
            System.arraycopy(t, 0, out, pos, n);
            pos += n;
        }
        return out;
    }
    static JSONObject open(String sealed, byte[] aesKey) throws Exception {
        byte[] all = b64d(sealed);
        Cipher ci = Cipher.getInstance("AES/GCM/NoPadding");
        ci.init(Cipher.DECRYPT_MODE, new SecretKeySpec(aesKey, "AES"), new GCMParameterSpec(128, Arrays.copyOfRange(all, 0, 12)));
        byte[] packed = ci.doFinal(Arrays.copyOfRange(all, 12, all.length));
        GZIPInputStream gz = new GZIPInputStream(new ByteArrayInputStream(packed));
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = gz.read(buf)) > 0) bo.write(buf, 0, n);
        return new JSONObject(new String(bo.toByteArray(), StandardCharsets.UTF_8));
    }

    // ---------------------------------------------------------------- revisar el buzón
    /** Trae los mensajes nuevos y muestra los avisos. Devuelve cuántos mostró. (Llamar fuera del hilo principal.) */
    static synchronized int check(Context c) {
        if (!configured(c)) return 0;
        SharedPreferences p = prefs(c);
        int shown = 0;
        try {
            byte[] master = b64d(p.getString("key", ""));
            String token = b64e(hkdf(master, "acceso", 32));
            byte[] aes = hkdf(master, "cifrado", 32);
            long after = p.getLong("after", 0);
            // since enorme: solo mensajes, sin traer las fotos de los demás (pesan y aquí no se usan).
            String u = p.getString("url", "") + "/v1/s/" + p.getString("space", "") + "/pull?device=" + p.getString("device", "") + "&since=9000000000000000&after=" + after;
            HttpURLConnection h = (HttpURLConnection) new URL(u).openConnection();
            h.setConnectTimeout(15000);
            h.setReadTimeout(20000);
            h.setRequestProperty("authorization", "Bearer " + token);
            if (h.getResponseCode() != 200) return 0;
            InputStream in = h.getInputStream();
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
            h.disconnect();
            JSONArray msgs = new JSONObject(new String(bo.toByteArray(), StandardCharsets.UTF_8)).optJSONArray("messages");
            if (msgs == null) return 0;
            long max = after;
            for (int i = 0; i < msgs.length(); i++) {
                JSONObject m = msgs.getJSONObject(i);
                long id = m.optLong("id");
                max = Math.max(max, id);
                JSONObject d;
                try { d = open(m.getString("data"), aes); } catch (Exception bad) { continue; }
                String type = d.optString("type");
                String kind = d.optString("kind");
                String from = d.optString("fromName", "Tu PC");
                String icon = "phone".equals(d.optString("fromKind")) ? "📱 " : "🖥️ ";
                if ("notify".equals(type)) {
                    if (notifyOnce(c, id, icon + from, d.optString("text"), d.optBoolean("pcActive", false))) shown++;
                } else if ("activity".equals(type) && kind.matches("level|achievement|joined|streak")) {
                    if (notifyOnce(c, id, "PM Pollito", d.optString("text"), true)) shown++;
                }
            }
            if (max > after) p.edit().putLong("after", max).apply();
        } catch (Exception e) {
            android.util.Log.w("PmCloud", "Revisar el buzón: " + e.getMessage());
        }
        return shown;
    }

    // ---------------------------------------------------------------- notificaciones (una sola vez cada una)
    static void ensureChannels(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (nm.getNotificationChannel(CH_LOUD) == null) nm.createNotificationChannel(new NotificationChannel(CH_LOUD, "Avisos de PM", NotificationManager.IMPORTANCE_HIGH));
        if (nm.getNotificationChannel(CH_QUIET) == null) nm.createNotificationChannel(new NotificationChannel(CH_QUIET, "Avisos silenciosos", NotificationManager.IMPORTANCE_LOW));
    }
    /**
     * Muestra el aviso si nadie lo mostró antes (lo pueden ver a la vez la parte web y esta). Con la
     * app en pantalla no se notifica: allí el pollito ya lo dice en su burbuja.
     */
    static synchronized boolean notifyOnce(Context c, long id, String title, String body, boolean silent) {
        SharedPreferences p = prefs(c);
        String seen = p.getString("seen", "");
        String key = "," + id + ",";
        if (id > 0 && ("," + seen + ",").contains(key)) return false;
        if (id > 0) {
            ArrayDeque<String> q = new ArrayDeque<>(Arrays.asList(seen.isEmpty() ? new String[0] : seen.split(",")));
            q.addLast(String.valueOf(id));
            while (q.size() > 300) q.removeFirst();
            p.edit().putString("seen", String.join(",", q)).apply();
        }
        Listener l = listener;
        if (l != null) l.onNotice(title, body);
        if (appVisible) return true;
        ensureChannels(c);
        Intent open = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(c, (int) (id % 100000), open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, silent ? CH_QUIET : CH_LOUD)
            .setSmallIcon(R.drawable.ic_stat_pm)
            .setColor(0xFFFF9F1C)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(pi)
            .setPriority(silent ? NotificationCompat.PRIORITY_LOW : NotificationCompat.PRIORITY_HIGH);
        try {
            NotificationManagerCompat.from(c).notify((int) (id > 0 ? id % Integer.MAX_VALUE : System.currentTimeMillis() % 100000), b.build());
        } catch (SecurityException noPermission) {
            return false;
        }
        return true;
    }
}
