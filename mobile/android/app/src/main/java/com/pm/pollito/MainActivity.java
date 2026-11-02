package com.pm.pollito;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PmNativePlugin.class); // ecosistema nativo, push y pollito flotante
        super.onCreate(savedInstanceState);
    }
}
