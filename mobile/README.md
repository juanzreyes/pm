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
