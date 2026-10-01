// Service worker: cada 30 s lee el estado de PM, pinta el icono y, en modo foco, activa las reglas
// que cambian los sitios que distraen por la pantalla del pollito. Menú "Enviar a PM".
/* global PMExt, chrome, importScripts */
importScripts('lib.js');

const BLOCKED = chrome.runtime.getURL('blocked.html');
const token = async () => (await chrome.storage.local.get('token')).token || '';
const opts = async () => ({ port: (await chrome.storage.local.get('port')).port });

async function refresh() {
  const t = await token();
  let st = null;
  let error = '';
  if (t) {
    try { st = await PMExt.call(t, '/browser/status', null, await opts()); } catch (e) { error = e.message; }
  } else error = 'Sin emparejar';
  await chrome.storage.session.set({ status: st, error, at: Date.now() });
  const b = PMExt.badge(st);
  await chrome.action.setBadgeText({ text: error && t ? '!' : b.text });
  await chrome.action.setBadgeBackgroundColor({ color: error && t ? '#e5484d' : b.color });
  await chrome.action.setTitle({ title: error ? `PM Pollito · ${error}` : `PM Pollito · sesión ${st.session ? st.session.pct + '%' : '—'} · ✅ ${st.tasks.done}/${st.tasks.total}` });
  await applyRules(st);
}

/** En foco (y sin "dame 5 min"): los sitios que distraen van a la pantalla del pollito. */
async function applyRules(st) {
  const { snoozeUntil = 0 } = await chrome.storage.session.get('snoozeUntil');
  const on = !!(st && st.focus && st.blockSites && st.blockSites.length && Date.now() > snoozeUntil);
  const want = on ? PMExt.rulesFor(st.blockSites, BLOCKED) : [];
  const have = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: have.map((r) => r.id), addRules: want });
}

function menus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'task', title: '📌 Enviar a PM como tarea', contexts: ['page', 'selection', 'link'] });
    chrome.contextMenus.create({ id: 'note', title: '📝 Guardar en las notas de hoy', contexts: ['page', 'selection', 'link'] });
  });
}
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const t = await token();
  if (!t) return chrome.runtime.openOptionsPage();
  const text = info.selectionText || '';
  const url = info.linkUrl || info.pageUrl || (tab && tab.url) || '';
  const title = info.linkUrl ? '' : (tab && tab.title) || '';
  try {
    await PMExt.call(t, '/browser/capture', { text, url, title, kind: info.menuItemId }, await opts());
    await chrome.action.setBadgeText({ text: '✓' });
    setTimeout(refresh, 1500);
  } catch (e) {
    await chrome.action.setBadgeText({ text: '!' });
    await chrome.action.setTitle({ title: 'PM Pollito · ' + e.message });
  }
});

// Mensajes de la ventanita y de la pantalla de bloqueo.
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    const t = await token();
    try {
      if (msg.type === 'refresh') { await refresh(); return reply({ ok: true }); }
      if (msg.type === 'snooze') {
        await chrome.storage.session.set({ snoozeUntil: Date.now() + 5 * 60e3 });
        await refresh();
        return reply({ ok: true });
      }
      if (msg.type === 'blocked') return reply(await PMExt.call(t, '/browser/blocked', { host: msg.host }, await opts()));
      if (msg.type === 'capture') { const r = await PMExt.call(t, '/browser/capture', msg.data, await opts()); setTimeout(refresh, 800); return reply(r); }
      if (msg.type === 'focus') { const r = await PMExt.call(t, '/browser/focus', msg.data, await opts()); await refresh(); return reply(r); }
      reply({ ok: false, error: 'Mensaje desconocido' });
    } catch (e) { reply({ ok: false, error: e.message }); }
  })();
  return true; // respuesta asíncrona
});

chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && (ch.token || ch.port)) refresh(); });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'tick') refresh(); });
chrome.runtime.onInstalled.addListener((d) => {
  menus();
  chrome.alarms.create('tick', { periodInMinutes: 0.5 });
  refresh();
  if (d.reason === 'install') chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup.addListener(() => { menus(); chrome.alarms.create('tick', { periodInMinutes: 0.5 }); refresh(); });
