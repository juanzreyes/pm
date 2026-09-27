// Genera build/icon.png (512x512) dibujando el pollito con el propio Electron.
// Uso: npm run icon
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="512" height="512">
  <defs>
    <radialGradient id="b" cx="40%" cy="35%" r="70%"><stop offset="0%" stop-color="#FFF08A"/><stop offset="60%" stop-color="#FFD84A"/><stop offset="100%" stop-color="#F9BE2A"/></radialGradient>
  </defs>
  <path d="M58 22 q-6 -12 2 -16 q-2 8 3 14z M61 21 q2 -13 11 -12 q-7 4 -7 13z M56 22 q-9 -6 -9 -12 q5 5 11 8z" fill="#FFD84A" stroke="#d99a14" stroke-width="1.4"/>
  <ellipse cx="22" cy="68" rx="11" ry="17" transform="rotate(20 22 68)" fill="#F3AE1C" stroke="#d99a14" stroke-width="1.4"/>
  <ellipse cx="98" cy="68" rx="11" ry="17" transform="rotate(-20 98 68)" fill="#F3AE1C" stroke="#d99a14" stroke-width="1.4"/>
  <ellipse cx="60" cy="62" rx="42" ry="43" fill="url(#b)" stroke="#d99a14" stroke-width="2"/>
  <ellipse cx="60" cy="82" rx="25" ry="17" fill="#fff6c4" opacity=".75"/>
  <ellipse cx="44" cy="56" rx="6.5" ry="8" fill="#2b1d1d"/><ellipse cx="76" cy="56" rx="6.5" ry="8" fill="#2b1d1d"/>
  <circle cx="46.5" cy="53" r="2.6" fill="#fff"/><circle cx="78.5" cy="53" r="2.6" fill="#fff"/>
  <ellipse cx="33" cy="71" rx="7.5" ry="4.8" fill="#ff8fa3" opacity=".6"/><ellipse cx="87" cy="71" rx="7.5" ry="4.8" fill="#ff8fa3" opacity=".6"/>
  <path d="M50 68 q10 -8 20 0 q-10 8 -20 0z" fill="#FF9F1C" stroke="#d97706" stroke-width="1"/>
  <g transform="rotate(-8 80 92)"><rect x="70" y="86" width="21" height="13" rx="3.5" fill="#4d7cfe" stroke="#2f55c7"/>
  <text x="80.5" y="95.8" text-anchor="middle" font-family="Segoe UI, sans-serif" font-weight="900" font-size="8.5" fill="#fff">PM</text></g>
</svg>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 512, height: 512, show: false, frame: false, transparent: true, webPreferences: { offscreen: true } });
  const html = `<html><body style="margin:0;background:transparent">${SVG}</body></html>`;
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 600));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  const out = path.join(__dirname, '..', 'build', 'icon.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, img.resize({ width: 512, height: 512 }).toPNG());
  console.log('Icono generado:', out);
  app.quit();
});
