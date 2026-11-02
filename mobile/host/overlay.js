// El pollito flotante (Android): al salir de PM, si lo activaste en Ajustes → Apariencia, se queda
// sobre las demás apps (PetOverlayService). Al volver a PM se esconde (aquí ya está el de verdad).
// Su imagen es una "foto" del pollito actual (especie, cosméticos, estado), no un ícono genérico.
const native = require('./native');

/** Foto del SVG del pollito con los estilos ya aplicados (sin hojas de estilo externas). */
async function snapshotPet(size = 220) {
  const frame = document.querySelector('#stage iframe');
  const doc = frame && frame.contentDocument;
  const svg = doc && doc.querySelector('#chick svg');
  if (!svg) return '';
  const win = frame.contentWindow;
  const clone = svg.cloneNode(true);
  const PROPS = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'fill-opacity', 'stroke-opacity', 'display', 'visibility', 'transform', 'transform-origin', 'transform-box', 'stop-color', 'stop-opacity', 'font', 'filter'];
  const src = [svg, ...svg.querySelectorAll('*')];
  const dst = [clone, ...clone.querySelectorAll('*')];
  for (let i = 0; i < src.length; i++) {
    const cs = win.getComputedStyle(src[i]);
    let style = '';
    for (const p of PROPS) { const v = cs.getPropertyValue(p); if (v) style += `${p}:${v};`; }
    dst[i].setAttribute('style', style);
    dst[i].removeAttribute('class');
  }
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  // Con margen: lo que sobresale del cuerpo (la tele, la cola del gallo, los audífonos) también sale.
  clone.setAttribute('viewBox', '-26 -14 172 154');
  clone.setAttribute('width', size);
  clone.setAttribute('height', Math.round(size * 154 / 172));
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone));
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
  const c = document.createElement('canvas');
  c.width = size;
  c.height = Math.round(size * 154 / 172);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/png');
}

async function state() {
  // Se pide como el panel (el proceso principal solo atiende a sus propias pantallas).
  const panel = document.querySelector('#main iframe');
  try { return JSON.parse(await globalThis.__pmHost.invoke(Number(panel && panel.name) || 0, 'get-state', '[]')); } catch { return null; }
}

async function onPause() {
  const s = await state();
  if (!s || !s.settings || !s.settings.petOverlay || !s.pet || !s.pet.name) return;
  if (!(await native.canDrawOverlays())) return;
  let png = '';
  try { png = await snapshotPet(); } catch { /* se queda con el ícono */ }
  native.overlayShow({ png, name: s.pet.name });
}
function onResume() { native.overlayHide(); }

/** Activar desde Ajustes: pide el permiso de Android si falta. Devuelve si ya se puede. */
async function enable(on) {
  if (!on) { native.overlayHide(); return true; }
  if (await native.canDrawOverlays()) return true;
  native.requestOverlay();
  return false;
}

function install() {
  globalThis.__pmPetSnapshot = snapshotPet; // también en el navegador, para probar
  if (!native.isNative()) return;
  native.onPause(onPause);
  native.onResume(onResume);
  globalThis.__pmOverlay = { enable, canDraw: native.canDrawOverlays, snapshot: snapshotPet };
}

module.exports = { install, snapshotPet };
