package com.pm.pollito;

import androidx.annotation.NonNull;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

/**
 * Push de Firebase (si la app tiene google-services.json y el Worker la cuenta de servicio): la
 * push no trae el aviso (todo va cifrado), solo "despierta" al teléfono para que revise el buzón.
 */
public class PmPushService extends FirebaseMessagingService {
    @Override
    public void onMessageReceived(@NonNull RemoteMessage msg) {
        PmCloud.checkSoon(getApplicationContext());
    }

    @Override
    public void onNewToken(@NonNull String token) {
        PmCloud.prefs(getApplicationContext()).edit().putString("pushToken", token).putBoolean("pushTokenSent", false).apply();
    }
}
