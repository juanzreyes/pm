package com.pm.pollito;

import android.animation.ObjectAnimator;
import android.animation.ValueAnimator;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import android.util.Base64;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.animation.AccelerateDecelerateInterpolator;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * El pollito flotante: vive sobre las demás apps (como las burbujas de chat). Se arrastra, se pega
 * al borde, un toque abre PM, y dice en su burbuja los avisos que llegan de tu PC. Mientras está
 * activo, revisa el buzón del ecosistema cada minuto (el servicio en primer plano mantiene viva la app).
 */
public class PetOverlayService extends Service {
    static final String ACTION_SHOW = "com.pm.pollito.overlay.SHOW";
    static final String ACTION_SAY = "com.pm.pollito.overlay.SAY";
    static final String ACTION_HIDE = "com.pm.pollito.overlay.HIDE";
    static final String CH = "pm-overlay";
    static volatile boolean running = false;
    /** Pegado al borde derecho: se ancla a ese borde para que la burbuja crezca hacia la izquierda. */
    private boolean right = true;

    private WindowManager wm;
    private LinearLayout root;
    private ImageView pet;
    private TextView bubble;
    private WindowManager.LayoutParams lp;
    private ObjectAnimator bob;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Runnable hideBubble = () -> { if (bubble != null) bubble.animate().alpha(0f).setDuration(220).withEndAction(() -> bubble.setVisibility(View.GONE)).start(); };
    private final Runnable poll = new Runnable() {
        @Override public void run() {
            io.execute(() -> PmCloud.check(getApplicationContext()));
            main.postDelayed(this, 60_000);
        }
    };

    @Override public IBinder onBind(Intent i) { return null; }

    private int dp(float v) { return (int) TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()); }
    private SharedPreferences prefs() { return getSharedPreferences("pm_overlay", MODE_PRIVATE); }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : ACTION_SHOW;
        if (ACTION_HIDE.equals(action) || !Settings.canDrawOverlays(this)) { stopSelf(); return START_NOT_STICKY; }
        startInForeground();
        if (root == null) build();
        if (intent != null) {
            String png = intent.getStringExtra("png");
            if (png != null && !png.isEmpty()) setImage(png);
            String text = intent.getStringExtra("text");
            if (text != null && !text.isEmpty()) say(text);
        }
        return START_STICKY;
    }

    private void startInForeground() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm.getNotificationChannel(CH) == null) {
                NotificationChannel ch = new NotificationChannel(CH, "Pollito flotante", NotificationManager.IMPORTANCE_MIN);
                ch.setShowBadge(false);
                nm.createNotificationChannel(ch);
            }
        }
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pOpen = PendingIntent.getActivity(this, 1, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent pHide = PendingIntent.getService(this, 2, new Intent(this, PetOverlayService.class).setAction(ACTION_HIDE), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new NotificationCompat.Builder(this, CH)
            .setSmallIcon(R.drawable.ic_stat_pm)
            .setContentTitle(prefs().getString("name", "Tu pollito") + " está contigo")
            .setContentText("Te aviso aquí de lo que pase en tu PC. Toca para abrir PM.")
            .setContentIntent(pOpen)
            .addAction(0, "Ocultar", pHide)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .build();
        ServiceCompat.startForeground(this, 4712, n, Build.VERSION.SDK_INT >= 34 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE : 0);
        running = true;
    }

    private void build() {
        wm = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER_HORIZONTAL);

        bubble = new TextView(this);
        bubble.setTextColor(Color.parseColor("#3B2F2F"));
        bubble.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        bubble.setMaxWidth(dp(220));
        bubble.setPadding(dp(12), dp(8), dp(12), dp(8));
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.parseColor("#FFFDF5"));
        bg.setCornerRadius(dp(16));
        bg.setStroke(dp(2), Color.parseColor("#3B2F2F"));
        bubble.setBackground(bg);
        bubble.setElevation(dp(3));
        bubble.setVisibility(View.GONE);
        root.addView(bubble, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT));

        pet = new ImageView(this);
        pet.setImageResource(R.mipmap.ic_launcher_foreground);
        pet.setScaleType(ImageView.ScaleType.FIT_CENTER);
        LinearLayout.LayoutParams pl = new LinearLayout.LayoutParams(dp(104), dp(96));
        pl.topMargin = dp(2);
        root.addView(pet, pl);

        lp = new WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
            Build.VERSION.SDK_INT >= 26 ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT);
        right = prefs().getBoolean("right", true);
        lp.x = prefs().getInt("edgeX", -dp(6));
        lp.y = prefs().getInt("y", dp(180));
        applySide();
        wm.addView(root, lp);

        // Respira (animación del sistema, sin costo para la batería).
        bob = ObjectAnimator.ofFloat(pet, "translationY", 0f, -dp(4), 0f);
        bob.setDuration(3400);
        bob.setRepeatCount(ValueAnimator.INFINITE);
        bob.setInterpolator(new AccelerateDecelerateInterpolator());
        bob.start();

        pet.setOnTouchListener(new View.OnTouchListener() {
            float sx, sy; int ox, oy; long t0; boolean moved;
            @Override public boolean onTouch(View v, MotionEvent e) {
                switch (e.getActionMasked()) {
                    case MotionEvent.ACTION_DOWN:
                        // Para arrastrar se usan coordenadas desde la izquierda.
                        if (right) { lp.x = getResources().getDisplayMetrics().widthPixels - lp.x - root.getWidth(); right = false; applySide(); wm.updateViewLayout(root, lp); }
                        sx = e.getRawX(); sy = e.getRawY(); ox = lp.x; oy = lp.y; t0 = System.currentTimeMillis(); moved = false;
                        pet.animate().scaleX(1.08f).scaleY(0.92f).setDuration(90).start();
                        return true;
                    case MotionEvent.ACTION_MOVE:
                        int dx = (int) (e.getRawX() - sx), dy = (int) (e.getRawY() - sy);
                        if (Math.abs(dx) + Math.abs(dy) > dp(8)) moved = true;
                        if (moved) { lp.x = ox + dx; lp.y = oy + dy; wm.updateViewLayout(root, lp); }
                        return true;
                    case MotionEvent.ACTION_UP:
                    case MotionEvent.ACTION_CANCEL:
                        pet.animate().scaleX(1f).scaleY(1f).setDuration(160).start();
                        if (!moved && System.currentTimeMillis() - t0 < 400) { openApp(); return true; }
                        snapToEdge();
                        return true;
                    default:
                        return false;
                }
            }
        });

        PmCloud.listener = (title, body) -> main.post(() -> say(body));
        main.postDelayed(poll, 5_000);
    }

    private void snapToEdge() {
        int w = getResources().getDisplayMetrics().widthPixels;
        boolean toRight = lp.x + root.getWidth() / 2 >= w / 2;
        int target = toRight ? w - root.getWidth() + dp(6) : -dp(6);
        ValueAnimator a = ValueAnimator.ofInt(lp.x, target);
        a.setDuration(220);
        a.addUpdateListener(an -> { lp.x = (int) an.getAnimatedValue(); try { wm.updateViewLayout(root, lp); } catch (Exception ignored) { } });
        a.addListener(new android.animation.AnimatorListenerAdapter() {
            @Override public void onAnimationEnd(android.animation.Animator an) {
                // Al terminar: anclado a su borde (a la derecha, medido desde la derecha).
                right = toRight;
                lp.x = -dp(6);
                applySide();
                try { wm.updateViewLayout(root, lp); } catch (Exception ignored) { }
                prefs().edit().putBoolean("right", right).putInt("edgeX", lp.x).putInt("y", lp.y).apply();
            }
        });
        a.start();
    }

    /** Gravedad según el borde: la burbuja crece hacia dentro de la pantalla. */
    private void applySide() {
        lp.gravity = Gravity.TOP | (right ? Gravity.END : Gravity.START);
        root.setGravity(right ? Gravity.END : Gravity.START);
    }

    private void openApp() {
        startActivity(new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP));
    }

    private void setImage(String dataUrl) {
        try {
            String b64 = dataUrl.contains(",") ? dataUrl.substring(dataUrl.indexOf(',') + 1) : dataUrl;
            byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
            Bitmap bm = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
            if (bm != null) pet.setImageBitmap(bm);
        } catch (Exception ignored) { /* se queda con el ícono */ }
    }

    private void say(String text) {
        if (bubble == null) return;
        bubble.setText(text.length() > 140 ? text.substring(0, 139) + "…" : text);
        bubble.setAlpha(0f);
        bubble.setVisibility(View.VISIBLE);
        bubble.animate().alpha(1f).setDuration(200).start();
        main.removeCallbacks(hideBubble);
        main.postDelayed(hideBubble, 7_000);
    }

    @Override
    public void onDestroy() {
        running = false;
        PmCloud.listener = null;
        main.removeCallbacksAndMessages(null);
        if (bob != null) bob.cancel();
        if (root != null && wm != null) { try { wm.removeView(root); } catch (Exception ignored) { } }
        root = null;
        io.shutdownNow();
        super.onDestroy();
    }
}
