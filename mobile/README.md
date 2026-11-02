# PM Pollito para Android

La app de Android corre **el mismo código que la de PC**: `main.js`, `src/**`, `preload.js` y
`renderer/**`. No hay una segunda app: lo que se agrega en la PC llega también al teléfono.

## Cómo funciona

```
mobile/
  shim/        Node y Electron imitados con lo que da el teléfono
    globals.js           Buffer, process, global, setTimeout(...).unref()
    electron.js          BrowserWindow → vistas con iframe, ipcMain, app, screen, notificaciones…
    renderer-electron.js ipcRenderer/contextBridge dentro de cada pantalla
    fs.js                archivos en memoria, guardados en IndexedDB
    crypto/os/child_process/worker_threads/http/…  lo justo, o "no disponible en Android"
  host/        la página anfitriona y lo nativo (Capacitor)
    views.js             pollito arriba, panel como pantalla principal, ajustes/juegos encima
    native.js            notificaciones, enlaces, botón atrás, escáner de QR (ML Kit)
    boot.js              carga los datos y hace require('../../main.js')
    mobile.css           ajustes de las pantallas de la PC para el teléfono (html.android)
  build.mjs    arma www/ con esbuild (host.bundle.js + preload.bundle.js + renderer/)
  android/     proyecto nativo de Capacitor
```

- Lo que no existe en el teléfono (git, Claude Code, la cola de Claude, ventanas, bandeja,
  IMAP) falla con los mensajes que la app ya maneja. Lo que hace falta de la PC (límites de
  Claude, avisos de Claude) llega por el **ecosistema** (`src/cloudsync.js`, `src/main/cloud.js`).
- `process.platform === 'android'` en el código compartido marca lo que se comporta distinto:
  el panel no se cierra, el dispositivo se presenta como teléfono…
- Las peticiones salen por CapacitorHttp (nativo, sin CORS).

## Avisos con la app cerrada

Lo nativo (`android/app/src/main/java/com/pm/pollito/`) revisa el buzón del ecosistema sin la
parte web: `PmCloud.java` es el mismo protocolo que `src/cloudsync.js` (HKDF + AES-256-GCM +
gzip), descifra los avisos en el teléfono y los muestra una sola vez (`notifyOnce`, también
para los que muestra la parte web).

| Cuándo | Cómo |
|---|---|
| App abierta | la parte web (cada 45 s, 20 s con actividad) |
| Pollito flotante activo | `PetOverlayService` revisa cada minuto (servicio en primer plano) |
| App cerrada | `PmSyncWorker` (WorkManager) cada 15 min, lo mínimo de Android |
| Con Firebase | la PC manda un mensaje → el Worker manda una push de "despierta" → revisión al instante |

### Activar las push al instante (Firebase)

1. En la consola de Firebase (el proyecto de eshoy sirve: `eshoy-c9074`) → **Agregar app →
   Android** con el paquete `com.pm.pollito`. Bajar `google-services.json` y ponerlo en
   `mobile/android/app/` (Gradle aplica el plugin solo si el archivo existe).
2. **Cuenta de servicio** (Configuración del proyecto → Cuentas de servicio → Generar clave):
   `cd cloud && npx wrangler secret put FCM_SERVICE_ACCOUNT < clave.json` y borrar el .json.
   Si es el mismo proyecto que eshoy, sirve la misma clave.
3. Recompilar el APK. La app registra su token sola (`PUT /v1/s/:space/push`).

La push no lleva el aviso (todo va cifrado): solo despierta al teléfono para que revise.

## Pollito flotante

`PetOverlayService`: ventana sobre las demás apps (permiso "Mostrar sobre otras apps"), con la
foto del pollito actual (`host/overlay.js` la saca del SVG con sus estilos), arrastrable, se pega
al borde, un toque abre PM y la burbuja dice los avisos. Se activa en Ajustes → Apariencia →
Pollito flotante; aparece al salir de PM y se esconde al volver.

## Compilar en esta PC

```bash
cd mobile
npm install
node build.mjs            # o: node build.mjs --serve  → http://localhost:5320 para probar en el navegador
npx cap sync android
cd android
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"
export JAVA_TOOL_OPTIONS="-Djdk.net.unixdomain.tmpdir=C:\\Desarrollo\\pm\\mobile\\.jtmp"
./gradlew.bat assembleDebug -Dorg.gradle.jvmargs="-Xmx2g -Djdk.net.unixdomain.tmpdir=C:\\Desarrollo\\pm\\mobile\\.jtmp"
# -PphoneOnly: sin librerías de emulador (x86): más liviano, para repartir a teléfonos
```

El `tmpdir` propio es obligatorio en esta máquina: sin él Gradle falla con "Unable to
establish loopback connection" (Java no puede crear el socket en el TEMP de ruta corta).

Íconos: `node scripts/icons.mjs` los regenera desde `build/icon.png`.

## Probado

- Emulador Pixel 8 Pro con Android 35 (páginas de 4 KB): arranca, se une al ecosistema con el
  código, adopta el pollito/nivel/cosméticos/tareas, muestra los límites de Claude de la PC.
- Emulador con imagen de páginas de 16 KB (`google_apis_playstore_ps16k`): el WebView 156 de
  esa imagen se cae a los 2-3 min en su hilo `MemoryInfra` (error de Chromium con 16 KB; la app
  no usa más de ~134 MB). En una imagen de 4 KB no pasa.
