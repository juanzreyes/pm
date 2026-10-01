// Logos de la Microsoft Store (build/appx/) a partir de build/icon.png.
//   npx electron scripts/make-appx-assets.js
// Sin ellos, electron-builder usa los logos genéricos de Electron.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const SIZES = [
  ['StoreLogo.png', 50, 50, 0.92],
  ['Square44x44Logo.png', 44, 44, 0.92],
  ['Square150x150Logo.png', 150, 150, 0.7],
  ['Wide310x150Logo.png', 310, 150, 0.7],
];

app.whenReady().then(async () => {
  const icon = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, '..', 'build', 'icon.png')).toString('base64');
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<canvas id=c></canvas>');
  const out = path.join(__dirname, '..', 'build', 'appx');
  fs.mkdirSync(out, { recursive: true });
  for (const [name, w, h, k] of SIZES) {
    const url = await win.webContents.executeJavaScript(`new Promise((ok) => {
      const img = new Image();
      img.onload = () => {
        const c = document.getElementById('c'); c.width = ${w}; c.height = ${h};
        const g = c.getContext('2d');
        g.imageSmoothingQuality = 'high';
        const s = Math.min(${w}, ${h}) * ${k};
        g.drawImage(img, (${w} - s) / 2, (${h} - s) / 2, s, s);
        ok(c.toDataURL('image/png'));
      };
      img.src = ${JSON.stringify(icon)};
    })`);
    fs.writeFileSync(path.join(out, name), Buffer.from(url.split(',')[1], 'base64'));
  }
  console.log('Logos de la Store en', out);
  app.quit();
});
