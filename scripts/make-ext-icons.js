// Íconos de la extensión del navegador a partir de build/icon.png.
//   npx electron scripts/make-ext-icons.js
const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

app.whenReady().then(() => {
  const src = nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png'));
  const out = path.join(__dirname, '..', 'extensions', 'browser', 'icons');
  fs.mkdirSync(out, { recursive: true });
  for (const s of [16, 48, 128]) fs.writeFileSync(path.join(out, `${s}.png`), src.resize({ width: s, height: s, quality: 'best' }).toPNG());
  console.log('Íconos listos en', out);
  app.quit();
});
