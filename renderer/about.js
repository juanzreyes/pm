// Ventana "Acerca de".
document.getElementById('close').addEventListener('click', () => pm.closeAbout());
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') pm.closeAbout(); });

document.getElementById('upd').addEventListener('click', async () => {
  const msg = document.getElementById('upd-msg');
  msg.textContent = '⏳';
  const r = await pm.checkUpdates();
  msg.textContent = r.ok ? `✅ v${r.version}` : r.error;
});

pm.getState().then((s) => {
  document.documentElement.classList.toggle('dark', !!s.dark);
  document.getElementById('ver').textContent = `${s.lang === 'en' ? 'version' : 'versión'} ${s.version}${s.packaged ? '' : ' (dev)'}`;
  if (s.lang === 'en') I18N.translateDom(document.body, 'en');
});
