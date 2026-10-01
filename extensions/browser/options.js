// Emparejar: guarda el código y comprueba que PM responde.
/* global chrome */
const $ = (s) => document.querySelector(s);
chrome.storage.local.get(['token', 'port']).then(({ token, port }) => { if (token) $('#code').value = token; if (port) $('#port').value = port; });
$('#f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const token = $('#code').value.trim();
  const port = Number($('#port').value) || undefined;
  $('#msg').className = 'small muted';
  $('#msg').textContent = 'Comprobando…';
  try {
    const st = await self.PMExt.call(token, '/browser/status', null, { port });
    await chrome.storage.local.set({ token, port: port || null });
    $('#msg').className = 'small';
    $('#msg').textContent = `✅ ¡Listo! Conectada con ${st.name || 'PM'}. Ya puedes cerrar esta pestaña.`;
  } catch (err) {
    $('#msg').className = 'small err';
    $('#msg').textContent = '😿 ' + err.message;
  }
});
const has = () => chrome.permissions.contains({ origins: ['*://*/*'] });
has().then((ok) => { $('#perm-msg').textContent = ok ? '✅ permitido' : ''; });
$('#perm').addEventListener('click', async () => {
  const ok = await chrome.permissions.request({ origins: ['*://*/*'] });
  $('#perm-msg').textContent = ok ? '✅ permitido' : 'no se dio el permiso';
});
