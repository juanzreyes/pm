// Íconos de Android a partir del ícono de la app de PC (build/icon.png), dibujados en un canvas de
// Chromium (no hace falta ninguna librería de imágenes):
//  · mipmap-*/ic_launcher(.png|_round.png)  → ícono clásico
//  · mipmap-*/ic_launcher_foreground.png     → capa del ícono adaptable (Android 8+), con margen seguro
//  · drawable/ic_stat_pm.xml                 → silueta blanca para la barra de notificaciones
//   node scripts/icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MOBILE = path.join(HERE, '..');
const RES = path.join(MOBILE, 'android', 'app', 'src', 'main', 'res');
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(MOBILE, '..', 'node_modules', 'playwright'));
const EXE = path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe');
const BG = '#FFF7E6';
const DENS = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

const src = 'data:image/png;base64,' + fs.readFileSync(path.join(MOBILE, '..', 'build', 'icon.png')).toString('base64');
const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage();
await page.setContent(`<img id="i" src="${src}">`);
await page.waitForFunction(() => document.getElementById('i').complete);
const draw = (size, mode) => page.evaluate(({ size, mode, BG }) => {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  const img = document.getElementById('i');
  if (mode === 'foreground') {
    // Zona segura del ícono adaptable: el dibujo ocupa ~62% del lienzo de 108 dp.
    const s = size * 0.62;
    g.drawImage(img, (size - s) / 2, (size - s) / 2, s, s);
  } else {
    g.fillStyle = BG;
    if (mode === 'round') { g.beginPath(); g.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2); g.fill(); g.save(); g.clip(); } else { const r = size * 0.22; g.beginPath(); g.roundRect(0, 0, size, size, r); g.fill(); g.save(); g.clip(); }
    const s = size * 0.84;
    g.drawImage(img, (size - s) / 2, (size - s) / 2, s, s);
    g.restore();
  }
  return c.toDataURL('image/png').split(',')[1];
}, { size, mode, BG });

for (const [d, k] of Object.entries(DENS)) {
  const dir = path.join(RES, 'mipmap-' + d);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ic_launcher.png'), Buffer.from(await draw(Math.round(48 * k), 'square'), 'base64'));
  fs.writeFileSync(path.join(dir, 'ic_launcher_round.png'), Buffer.from(await draw(Math.round(48 * k), 'round'), 'base64'));
  fs.writeFileSync(path.join(dir, 'ic_launcher_foreground.png'), Buffer.from(await draw(Math.round(108 * k), 'foreground'), 'base64'));
}
await browser.close();
fs.writeFileSync(path.join(RES, 'values', 'ic_launcher_background.xml'), `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${BG}</color>\n</resources>\n`);
// Silueta del pollito (cuerpo, copete y pico) para la barra de notificaciones: blanca y sin degradados.
fs.mkdirSync(path.join(RES, 'drawable'), { recursive: true });
fs.writeFileSync(path.join(RES, 'drawable', 'ic_stat_pm.xml'), `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
    <path android:fillColor="#FFFFFFFF" android:pathData="M12,6.2c4.3,0 7.6,3.3 7.6,7.4c0,4.2 -3.4,7.2 -7.6,7.2s-7.6,-3 -7.6,-7.2C4.4,9.5 7.7,6.2 12,6.2zM11.2,2.4c0.9,0.4 1.2,1.6 0.9,3.1c-0.9,-0.5 -1.6,-1.6 -0.9,-3.1zM13.6,2.9c0.8,0.6 0.7,1.8 -0.1,2.8c-0.4,-0.9 -0.4,-2.1 0.1,-2.8z"/>
</vector>
`);
console.log('íconos listos');
