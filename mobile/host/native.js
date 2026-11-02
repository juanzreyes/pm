// Lo nativo del teléfono (Capacitor), con alternativas de navegador para probar en la PC.
const { Capacitor, registerPlugin } = require('@capacitor/core');
// Plugin propio (android/.../PmNativePlugin.java): buzón con la app cerrada, avisos sin duplicar, push y pollito flotante.
const PmNative = registerPlugin('PmNative');
const { LocalNotifications } = require('@capacitor/local-notifications');
const { App } = require('@capacitor/app');
const { Browser } = require('@capacitor/browser');
const { BarcodeScanner, BarcodeFormat } = require('@capacitor-mlkit/barcode-scanning');

const isNative = () => Capacitor.isNativePlatform();
let nid = Math.floor(Date.now() / 1000) % 100000;
const taps = new Map(); // id de notificación → fn

async function ensureNotifications() {
  try {
    const p = await LocalNotifications.checkPermissions();
    if (p.display !== 'granted') await LocalNotifications.requestPermissions();
    if (isNative()) {
      await LocalNotifications.createChannel({ id: 'pm', name: 'Avisos de PM', description: 'Lo que te dice el pollito', importance: 4, visibility: 1, vibration: true });
      await LocalNotifications.createChannel({ id: 'pm-quiet', name: 'Avisos silenciosos', description: 'Actividad de tus otros dispositivos', importance: 2, visibility: 1, vibration: false });
    }
  } catch (e) { console.warn('Notificaciones:', e.message); }
}
async function notify({ title, body, silent, extra }) {
  const id = ++nid;
  // En el teléfono, por el plugin propio: notificación inmediata, sin "alarma exacta". El de Capacitor
  // marca todo como alarma exacta por defecto y, sin ese permiso, abre solo la pantalla de
  // "Alarmas y recordatorios" de Android cada vez.
  if (isNative()) {
    try { await PmNative.notifyOnce({ id: 0, title: String(title || 'PM Pollito').slice(0, 80), body: String(body || '').slice(0, 400), silent: !!silent }); } catch (e) { console.warn('Notificación:', e.message); }
    return id;
  }
  try {
    await LocalNotifications.schedule({ notifications: [{ id, title: String(title || 'PM Pollito').slice(0, 80), body: String(body || '').slice(0, 400), channelId: silent ? 'pm-quiet' : 'pm', smallIcon: 'ic_stat_pm', isExactNotification: false, ...(extra ? { extra } : {}) }] });
  } catch (e) { console.warn('Notificación:', e.message); }
  return id;
}
function onNotificationTap(obj, fn) { if (obj && obj.nid) taps.set(obj.nid, fn); else setTimeout(() => obj && obj.nid && taps.set(obj.nid, fn), 50); }
const cancelNotification = (id) => LocalNotifications.cancel({ notifications: [{ id }] }).catch(() => {});
LocalNotifications.addListener('localNotificationActionPerformed', (a) => {
  const fn = taps.get(a.notification.id);
  if (fn) fn();
  if (globalThis.__pmOnNotificationTap) globalThis.__pmOnNotificationTap(a.notification);
}).catch(() => {});

function openExternal(url) {
  if (isNative()) Browser.open({ url }).catch(() => window.open(url, '_blank'));
  else window.open(url, '_blank', 'noopener');
}
function copy(text) {
  try { navigator.clipboard.writeText(String(text)); } catch { /* sin permiso */ }
}
function minimize() { if (isNative()) App.minimizeApp().catch(() => {}); }
function onBack(fn) {
  if (!isNative()) return;
  App.addListener('backButton', () => { if (!fn()) App.minimizeApp(); });
}
function onPause(fn) { App.addListener('pause', fn).catch(() => {}); }
function onResume(fn) { App.addListener('resume', fn).catch(() => {}); }
async function info() {
  try { const i = await App.getInfo(); return { version: i.version, build: i.build }; } catch { return { version: '', build: '' }; }
}
/** Nombre del teléfono a partir del User-Agent ("Android 14; Pixel 8 Pro"). */
function deviceName() {
  const m = /Android [\d.]+; ([^;)]+)/.exec(navigator.userAgent);
  return m ? m[1].replace(/ Build.*$/, '').trim() : 'Android';
}

/** Escanea el QR de vinculación con la pantalla de Google (no hace falta pedir la cámara). */
async function scanQR() {
  if (!isNative()) return { status: 'unsupported' };
  try {
    const { supported } = await BarcodeScanner.isSupported();
    if (!supported) return { status: 'unsupported' };
    const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
    if (!available) { await BarcodeScanner.installGoogleBarcodeScannerModule(); return { status: 'installing' }; }
    const { barcodes } = await BarcodeScanner.scan({ formats: [BarcodeFormat.QrCode] });
    const value = barcodes[0] && (barcodes[0].rawValue || barcodes[0].displayValue);
    return value ? { status: 'success', value } : { status: 'cancelled' };
  } catch (e) {
    return { status: /cancel/i.test(e.message || '') ? 'cancelled' : 'error', error: e.message };
  }
}

const nativeOnly = (fn, fallback) => async (...a) => { if (!isNative()) return fallback; try { return await fn(...a); } catch (e) { console.warn('PmNative:', e.message); return fallback; } };
const configureCloud = nativeOnly((cfg) => PmNative.configure({ cfg }), null);
const notifyOnce = nativeOnly(async (id, title, body, silent) => (await PmNative.notifyOnce({ id: Number(id) || 0, title, body, silent: !!silent })).shown, false);
const pushToken = nativeOnly(async () => (await PmNative.pushToken()).token || null, null);
const canDrawOverlays = nativeOnly(async () => (await PmNative.canDrawOverlays()).granted, false);
const requestOverlay = nativeOnly(() => PmNative.requestOverlay(), null);
const overlayShow = nativeOnly((o) => PmNative.overlayShow(o), null);
const overlayHide = nativeOnly(() => PmNative.overlayHide(), null);

module.exports = { configureCloud, notifyOnce, pushToken, canDrawOverlays, requestOverlay, overlayShow, overlayHide, scanQR, isNative, ensureNotifications, notify, onNotificationTap, cancelNotification, openExternal, copy, minimize, onBack, onPause, onResume, info, deviceName };
