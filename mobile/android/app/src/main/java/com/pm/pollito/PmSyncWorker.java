package com.pm.pollito;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.ForegroundInfo;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import androidx.core.app.NotificationCompat;

/** Revisa el buzón del ecosistema con la app cerrada (cada 15 min, o al llegar una push de "despierta"). */
public class PmSyncWorker extends Worker {
    public PmSyncWorker(@NonNull Context c, @NonNull WorkerParameters p) { super(c, p); }

    @NonNull
    @Override
    public Result doWork() {
        PmCloud.check(getApplicationContext());
        return Result.success();
    }

    /** Para el trabajo "urgente" (expedited) en Android 11 o menos, que pide una notificación de primer plano. */
    @NonNull
    @Override
    public ForegroundInfo getForegroundInfo() {
        PmCloud.ensureChannels(getApplicationContext());
        return new ForegroundInfo(4711, new NotificationCompat.Builder(getApplicationContext(), PmCloud.CH_QUIET)
            .setSmallIcon(R.drawable.ic_stat_pm)
            .setContentTitle("PM Pollito")
            .setContentText("Revisando tus avisos…")
            .build());
    }
}
